import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { pluginsApi } from "@/lib/api";
import type { TriggerRule } from "@/types/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ToggleSwitch } from "@/components/ui/toggle-switch";
import { Trash2, Plus, Check } from "lucide-react";

interface Props {
  pluginID: string;
  connectionID: string;
}

export function TriggerRulesEditor({ pluginID, connectionID }: Props) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["trigger-rules", pluginID, connectionID],
    queryFn: () => pluginsApi.triggerRules.list(pluginID, connectionID),
  });

  const createMut = useMutation({
    mutationFn: (rule: TriggerRule) => pluginsApi.triggerRules.create(pluginID, connectionID, rule),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["trigger-rules", pluginID, connectionID] }),
  });

  const updateMut = useMutation({
    mutationFn: ({ name, rule }: { name: string; rule: TriggerRule }) =>
      pluginsApi.triggerRules.update(pluginID, connectionID, name, rule),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["trigger-rules", pluginID, connectionID] }),
  });

  const deleteMut = useMutation({
    mutationFn: (name: string) => pluginsApi.triggerRules.delete(pluginID, connectionID, name),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["trigger-rules", pluginID, connectionID] }),
  });

  const [editing, setEditing] = useState<TriggerRule | null>(null);
  const [showAdd, setShowAdd] = useState(false);

  const rules = data?.rules ?? [];

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-medium">Trigger Rules</h4>
        <Button size="sm" variant="outline" onClick={() => { setEditing(null); setShowAdd(true); }}>
          <Plus className="w-3 h-3 mr-1" /> Add Rule
        </Button>
      </div>

      {isLoading && <p className="text-xs text-muted-foreground">Loading...</p>}

      <div className="space-y-2">
        {rules.map((rule) => (
          <div key={rule.name} className="rounded border p-2 text-xs space-y-1">
            <div className="flex items-center justify-between">
              <span className="font-medium">{rule.name}</span>
              <div className="flex gap-2">
                <Button size="sm" variant="ghost" onClick={() => { setEditing(rule); setShowAdd(false); }}>
                  Edit
                </Button>
                <Button size="sm" variant="ghost" onClick={() => deleteMut.mutate(rule.name)}>
                  <Trash2 className="w-3 h-3 text-destructive" />
                </Button>
              </div>
            </div>
            <div className="text-muted-foreground">
              Assistant: {rule.assistant_id} | Enabled: {rule.enabled ? "Yes" : "No"}
              {rule.from_contains && <div>From contains: {rule.from_contains}</div>}
              {rule.subject_contains && <div>Subject contains: {rule.subject_contains}</div>}
              {rule.body_contains && <div>Body contains: {rule.body_contains}</div>}
            </div>
          </div>
        ))}
      </div>

      {(showAdd || editing) && (
        <TriggerRuleForm
          rule={editing}
          onSave={(rule) => {
            if (editing) {
              updateMut.mutate({ name: editing.name, rule });
            } else {
              createMut.mutate(rule);
            }
            setShowAdd(false);
            setEditing(null);
          }}
          onCancel={() => { setShowAdd(false); setEditing(null); }}
        />
      )}
    </div>
  );
}

interface FormProps {
  rule: TriggerRule | null;
  onSave: (rule: TriggerRule) => void;
  onCancel: () => void;
}

function TriggerRuleForm({ rule, onSave, onCancel }: FormProps) {
  const [name, setName] = useState(rule?.name ?? "");
  const [assistantID, setAssistantID] = useState(rule?.assistant_id ?? "");
  const [fromContains, setFromContains] = useState(rule?.from_contains ?? "");
  const [subjectContains, setSubjectContains] = useState(rule?.subject_contains ?? "");
  const [bodyContains, setBodyContains] = useState(rule?.body_contains ?? "");
  const [enabled, setEnabled] = useState(rule?.enabled ?? true);

  const handleSave = () => {
    if (!name.trim() || !assistantID.trim()) return;
    onSave({
      name: name.trim(),
      assistant_id: assistantID.trim(),
      from_contains: fromContains.trim(),
      subject_contains: subjectContains.trim(),
      body_contains: bodyContains.trim(),
      enabled,
    });
  };

  return (
    <div className="rounded border p-3 space-y-2 bg-muted/50">
      <h5 className="text-sm font-medium">{rule ? "Edit Rule" : "New Rule"}</h5>
      <div className="grid grid-cols-2 gap-2">
        <Input placeholder="Rule name" value={name} onChange={(e) => setName(e.target.value)} />
        <Input placeholder="Assistant ID" value={assistantID} onChange={(e) => setAssistantID(e.target.value)} />
        <Input placeholder="From contains (optional)" value={fromContains} onChange={(e) => setFromContains(e.target.value)} />
        <Input placeholder="Subject contains (optional)" value={subjectContains} onChange={(e) => setSubjectContains(e.target.value)} />
        <Input placeholder="Body contains (optional)" value={bodyContains} onChange={(e) => setBodyContains(e.target.value)} />
        <div className="flex items-center gap-2">
          <ToggleSwitch checked={enabled} onChange={setEnabled} />
          <span className="text-xs">{enabled ? "Enabled" : "Disabled"}</span>
        </div>
      </div>
      <div className="flex gap-2">
        <Button size="sm" onClick={handleSave}>
          <Check className="w-3 h-3 mr-1" /> Save
        </Button>
        <Button size="sm" variant="outline" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
}
