-- Backfill llm.chat capability + permission rule for assistants seeded
-- before llm.chat was a first-class capability. Without it, every step the
-- planner emits hits the permission engine with a "blocked by policy" error
-- because the LLM client itself goes through the permission engine.
-- Idempotent: only patches rows whose JSON does not already mention llm.chat.
--
-- Privilege-escalation guard: skip any row whose existing policy contains
-- a deny rule for llm.chat or for the wildcard "*". MatchingRule treats
-- exact matches as winning over wildcards, so blindly appending
-- {llm.chat: allow} after a `*=deny` would silently flip a deny-all
-- assistant into allow-llm.chat. The explicit-deny case is rarer but the
-- intent is just as load-bearing, so we treat it the same way.

-- 1. Capabilities array. Append "llm.chat" when absent.
UPDATE assistants
SET capabilities = json_insert(
    COALESCE(capabilities, json('[]')),
    '$[#]',
    'llm.chat'
)
WHERE NOT EXISTS (
    SELECT 1 FROM json_each(COALESCE(assistants.capabilities, json('[]')))
    WHERE value = 'llm.chat'
);

-- 2. Permission policy rules array. Append {capability:"llm.chat",mode:"allow"}
--    when no rule references llm.chat. Cover three legacy shapes:
--      a) permission_policy IS NULL or '' — seed full structure.
--      b) permission_policy has no .rules key — initialise with the new rule.
--      c) permission_policy.rules exists — append.
UPDATE assistants
SET permission_policy = json_object(
    'rules', json_array(json_object('capability', 'llm.chat', 'mode', 'allow'))
)
WHERE permission_policy IS NULL OR permission_policy = '';

UPDATE assistants
SET permission_policy = json_set(
    permission_policy,
    '$.rules',
    json_array(json_object('capability', 'llm.chat', 'mode', 'allow'))
)
WHERE json_extract(permission_policy, '$.rules') IS NULL;

UPDATE assistants
SET permission_policy = json_insert(
    permission_policy,
    '$.rules[#]',
    json_object('capability', 'llm.chat', 'mode', 'allow')
)
WHERE json_extract(permission_policy, '$.rules') IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM json_each(json_extract(assistants.permission_policy, '$.rules')) je
    WHERE json_extract(je.value, '$.capability') = 'llm.chat'
  )
  -- Don't override an existing deny-all wildcard.
  AND NOT EXISTS (
    SELECT 1 FROM json_each(json_extract(assistants.permission_policy, '$.rules')) je
    WHERE json_extract(je.value, '$.capability') = '*'
      AND json_extract(je.value, '$.mode') = 'deny'
  );
