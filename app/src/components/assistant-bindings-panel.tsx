import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { assistantBindingsApi, pluginsApi } from "@/lib/api";
import { errorMessage } from "@/lib/utils";
import type {
  AssistantBinding,
  BindingRole,
  Plugin,
  PluginConnection,
} from "@/types/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Plus, Star, Trash2 } from "lucide-react";

// AssistantBindingsPanel lets users compose an assistant from the pool
// of plugin Connections — the "build my agent" composer described in
// ADR 0001 §5. Rendered inside the Assistant edit dialog.
//
// Mental model: Connections are configured once in the Plugins tab;
// here, agents pick which ones they can use and for which role
// (channel / tool / trigger / context_source). Multiple bindings of
// the same (plugin, role) are allowed with exactly one marked primary
// for unambiguous inbound routing.

const ROLE_LABELS: Record<BindingRole, string> = {
  channel: "Channel (conversational)",
  tool: "Tool (actions)",
  trigger: "Trigger (background events)",
  context_source: "Context (read at plan time)",
};

function roleCandidatesForPlugin(plugin: Plugin): BindingRole[] {
  const out: BindingRole[] = [];
  if ((plugin.manifest.contributes.channels ?? []).length > 0) out.push("channel");
  if ((plugin.manifest.contributes.tools ?? []).length > 0) out.push("tool");
  if ((plugin.manifest.contributes.triggers ?? []).length > 0) out.push("trigger");
  if ((plugin.manifest.contributes.context_sources ?? []).length > 0) out.push("context_source");
  return out;
}

function findConnection(plugins: Plugin[], connectionID: string): PluginConnection | undefined {
  for (const p of plugins) {
    const match = p.connections.find((c) => c.id === connectionID);
    if (match) return match;
  }
  return undefined;
}

function findPlugin(plugins: Plugin[], connectionID: string): Plugin | undefined {
  for (const p of plugins) {
    if (p.connections.some((c) => c.id === connectionID)) return p;
  }
  return undefined;
}

function BindingRow({
  binding,
  plugins,
  onUpdate,
  onDelete,
  disabled,
}: {
  binding: AssistantBinding;
  plugins: Plugin[];
  onUpdate: (patch: Partial<AssistantBinding>) => void;
  onDelete: () => void;
  disabled: boolean;
}) {
  const conn = findConnection(plugins, binding.connection_id);
  const plugin = findPlugin(plugins, binding.connection_id);

  return (
    <div className="flex items-center justify-between border rounded-md p-2 text-sm">
      <div className="min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium truncate">{conn?.name ?? binding.connection_id}</span>
          {plugin && (
            <Badge variant="outline" className="text-[10px]">
              {plugin.manifest.name}
            </Badge>
          )}
          <Badge variant="secondary" className="text-[10px]">
            {binding.role}
          </Badge>
          {binding.is_primary && (
            <Badge variant="default" className="text-[10px] bg-amber-500">
              primary
            </Badge>
          )}
          {!binding.enabled && (
            <Badge variant="outline" className="text-[10px]">
              disabled
            </Badge>
          )}
        </div>
        {!conn && (
          <p className="text-xs text-destructive mt-0.5">
            Connection no longer exists — remove this binding.
          </p>
        )}
      </div>
      <div className="flex items-center gap-1">
        {!binding.is_primary && (
          <Button
            size="sm"
            variant="ghost"
            title="Mark as primary"
            disabled={disabled}
            onClick={() => onUpdate({ is_primary: true })}
          >
            <Star className="w-4 h-4" />
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          title="Remove binding"
          disabled={disabled}
          onClick={onDelete}
        >
          <Trash2 className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );
}

function AddBindingForm({
  plugins,
  existing,
  onAdd,
  onCancel,
  pending,
}: {
  plugins: Plugin[];
  existing: AssistantBinding[];
  onAdd: (data: { connection_id: string; role: BindingRole }) => void;
  onCancel: () => void;
  pending: boolean;
}) {
  const [pluginID, setPluginID] = useState("");
  const [connectionID, setConnectionID] = useState("");
  const [role, setRole] = useState<BindingRole | "">("");

  const selectedPlugin = plugins.find((p) => p.manifest.id === pluginID);
  const availableConnections = selectedPlugin?.connections ?? [];
  const availableRoles = selectedPlugin ? roleCandidatesForPlugin(selectedPlugin) : [];

  // Filter out role-connection pairs the assistant is already bound to.
  const isTaken = (cid: string, r: BindingRole) =>
    existing.some((b) => b.connection_id === cid && b.role === r);

  return (
    <div className="border rounded-md p-3 space-y-2 bg-background">
      <div className="space-y-1">
        <label className="text-xs font-medium">Plugin</label>
        <select
          className="w-full text-sm border rounded px-2 py-1 bg-background"
          value={pluginID}
          onChange={(e) => {
            setPluginID(e.target.value);
            setConnectionID("");
            setRole("");
          }}
        >
          <option value="">Choose a plugin…</option>
          {plugins.map((p) => (
            <option key={p.manifest.id} value={p.manifest.id}>
              {p.manifest.name}
            </option>
          ))}
        </select>
      </div>
      {pluginID && (
        <div className="space-y-1">
          <label className="text-xs font-medium">Connection</label>
          <select
            className="w-full text-sm border rounded px-2 py-1 bg-background"
            value={connectionID}
            onChange={(e) => setConnectionID(e.target.value)}
          >
            <option value="">Choose a connection…</option>
            {availableConnections.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} {c.enabled ? "" : "(disabled)"}
              </option>
            ))}
          </select>
          {availableConnections.length === 0 && (
            <p className="text-xs text-muted-foreground">
              No connections yet. Add one in the Plugins tab first.
            </p>
          )}
        </div>
      )}
      {connectionID && (
        <div className="space-y-1">
          <label className="text-xs font-medium">Role</label>
          <select
            className="w-full text-sm border rounded px-2 py-1 bg-background"
            value={role}
            onChange={(e) => setRole(e.target.value as BindingRole)}
          >
            <option value="">Choose a role…</option>
            {availableRoles.map((r) => (
              <option key={r} value={r} disabled={isTaken(connectionID, r)}>
                {ROLE_LABELS[r]}
                {isTaken(connectionID, r) ? " (already bound)" : ""}
              </option>
            ))}
          </select>
        </div>
      )}
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          size="sm"
          disabled={!connectionID || !role || pending}
          onClick={() => role && onAdd({ connection_id: connectionID, role })}
        >
          {pending ? "Adding…" : "Bind"}
        </Button>
      </div>
    </div>
  );
}

export function AssistantBindingsPanel({ assistantID }: { assistantID: string }) {
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);

  const pluginsQuery = useQuery({
    queryKey: ["plugins"],
    queryFn: () => pluginsApi.list(),
    refetchInterval: 10_000,
  });
  const bindingsQuery = useQuery({
    queryKey: ["assistant-bindings", assistantID],
    queryFn: () => assistantBindingsApi.list(assistantID),
    enabled: !!assistantID,
  });

  const plugins = useMemo(() => pluginsQuery.data?.plugins ?? [], [pluginsQuery.data]);
  const bindings = useMemo(() => bindingsQuery.data?.bindings ?? [], [bindingsQuery.data]);

  const upsert = useMutation({
    mutationFn: (data: {
      connection_id: string;
      role: BindingRole;
      enabled: boolean;
      is_primary?: boolean;
      priority?: number;
    }) => assistantBindingsApi.upsert(assistantID, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["assistant-bindings", assistantID] });
    },
  });

  const remove = useMutation({
    mutationFn: (data: { connection_id: string; role: BindingRole }) =>
      assistantBindingsApi.delete(assistantID, data.connection_id, data.role),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["assistant-bindings", assistantID] });
    },
  });

  if (!assistantID) {
    return (
      <p className="text-sm text-muted-foreground">
        Save the assistant first to configure connection bindings.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {bindingsQuery.error && (
        <p className="text-sm text-destructive">{errorMessage(bindingsQuery.error)}</p>
      )}
      {bindings.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No connection bindings yet. Bind at least one plugin connection so this assistant
          can send messages, invoke tools, or react to triggers.
        </p>
      ) : (
        <div className="space-y-2">
          {bindings.map((b) => (
            <BindingRow
              key={`${b.connection_id}:${b.role}`}
              binding={b}
              plugins={plugins}
              onUpdate={(patch) =>
                upsert.mutate({
                  connection_id: b.connection_id,
                  role: b.role,
                  enabled: patch.enabled ?? b.enabled,
                  is_primary: patch.is_primary ?? b.is_primary,
                  priority: patch.priority ?? b.priority,
                })
              }
              onDelete={() =>
                remove.mutate({ connection_id: b.connection_id, role: b.role })
              }
              disabled={upsert.isPending || remove.isPending}
            />
          ))}
        </div>
      )}

      {!adding ? (
        <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
          <Plus className="w-4 h-4 mr-1" /> Bind a connection
        </Button>
      ) : (
        <AddBindingForm
          plugins={plugins}
          existing={bindings}
          pending={upsert.isPending}
          onCancel={() => setAdding(false)}
          onAdd={(data) => {
            // First binding for this (plugin, role) is auto-marked
            // primary so inbound routing is unambiguous without the
            // user having to remember to mark it.
            const sameRolePluginBindings = bindings.filter(
              (b) =>
                b.role === data.role &&
                findPlugin(plugins, b.connection_id)?.manifest.id ===
                  findPlugin(plugins, data.connection_id)?.manifest.id,
            );
            upsert.mutate(
              {
                connection_id: data.connection_id,
                role: data.role,
                enabled: true,
                is_primary: sameRolePluginBindings.length === 0,
              },
              {
                onSuccess: () => setAdding(false),
              },
            );
          }}
        />
      )}
    </div>
  );
}
