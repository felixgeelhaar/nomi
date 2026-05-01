import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { identitiesApi } from "@/lib/api";
import { errorMessage } from "@/lib/utils";
import type { ChannelIdentity } from "@/types/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Plus, Trash2, Check, UserPlus } from "lucide-react";

// IdentityAllowlist renders the per-connection ChannelIdentity list with
// inline add / toggle / delete. Empty allowlist is rendered with a
// warning-coloured hint: per ADR 0001 §9 + the Telegram plugin's gating
// logic, an empty list means "allow everyone" for backward compatibility.
// Once the first entry is added, the list becomes strict.

export function IdentityAllowlist({
  pluginID,
  connectionID,
}: {
  pluginID: string;
  connectionID: string;
}) {
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);

  const { data, error, isLoading } = useQuery({
    queryKey: ["identities", pluginID, connectionID],
    queryFn: () => identitiesApi.list(pluginID, connectionID),
  });
  const identities = data?.identities ?? [];

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <UserPlus className="w-4 h-4 text-muted-foreground" />
        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Identity allowlist
        </h4>
      </div>
      {isLoading ? (
        <p className="text-xs text-muted-foreground">Loading…</p>
      ) : identities.length === 0 ? (
        <div className="text-xs border border-amber-300 bg-amber-50 text-amber-900 rounded p-2">
          <p className="font-medium">Open to anyone</p>
          <p>
            This connection has no identity allowlist configured, so anyone who reaches the
            bot is allowed through. Add at least one entry to gate access.
          </p>
        </div>
      ) : (
        <div className="space-y-1">
          {identities.map((ident) => (
            <IdentityRow key={ident.id} identity={ident} />
          ))}
        </div>
      )}
      {error && <p className="text-xs text-destructive">{errorMessage(error)}</p>}

      {!adding ? (
        <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
          <Plus className="w-4 h-4 mr-1" /> Add identity
        </Button>
      ) : (
        <AddIdentityForm
          pluginID={pluginID}
          connectionID={connectionID}
          onCancel={() => setAdding(false)}
          onSuccess={() => {
            qc.invalidateQueries({ queryKey: ["identities", pluginID, connectionID] });
            setAdding(false);
          }}
        />
      )}
    </div>
  );
}

function IdentityRow({ identity }: { identity: ChannelIdentity }) {
  const qc = useQueryClient();
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const toggle = useMutation({
    mutationFn: (enabled: boolean) =>
      identitiesApi.update(identity.plugin_id, identity.connection_id, identity.id, { enabled }),
    onSuccess: () =>
      qc.invalidateQueries({
        queryKey: ["identities", identity.plugin_id, identity.connection_id],
      }),
  });

  const remove = useMutation({
    mutationFn: () =>
      identitiesApi.delete(identity.plugin_id, identity.connection_id, identity.id),
    onSuccess: () =>
      qc.invalidateQueries({
        queryKey: ["identities", identity.plugin_id, identity.connection_id],
      }),
  });

  return (
    <div className="flex items-center justify-between border rounded p-2 text-xs">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium truncate">
            {identity.display_name || identity.external_identifier}
          </span>
          {!identity.enabled && (
            <Badge variant="outline" className="text-[9px]">
              disabled
            </Badge>
          )}
        </div>
        <div className="text-muted-foreground mt-0.5">
          <code className="font-mono">{identity.external_identifier}</code>
          {identity.allowed_assistants.length > 0 && (
            <> · {identity.allowed_assistants.length} assistant(s)</>
          )}
        </div>
      </div>
      <div className="flex items-center gap-1">
        <Button
          size="sm"
          variant="ghost"
          onClick={() => toggle.mutate(!identity.enabled)}
          disabled={toggle.isPending}
        >
          {identity.enabled ? "Disable" : "Enable"}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            if (confirmingDelete) {
              remove.mutate();
              setConfirmingDelete(false);
            } else {
              setConfirmingDelete(true);
              setTimeout(() => setConfirmingDelete(false), 3000);
            }
          }}
          disabled={remove.isPending}
          className={confirmingDelete ? "text-destructive" : ""}
        >
          {confirmingDelete ? <Check className="w-4 h-4" /> : <Trash2 className="w-4 h-4" />}
        </Button>
      </div>
    </div>
  );
}

function AddIdentityForm({
  pluginID,
  connectionID,
  onCancel,
  onSuccess,
}: {
  pluginID: string;
  connectionID: string;
  onCancel: () => void;
  onSuccess: () => void;
}) {
  const [externalID, setExternalID] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () =>
      identitiesApi.create(pluginID, connectionID, {
        external_identifier: externalID.trim(),
        display_name: displayName.trim(),
        enabled: true,
      }),
    onSuccess,
    onError: (err) => setError(errorMessage(err)),
  });

  return (
    <div className="border rounded-md p-2 space-y-2 bg-background">
      <div className="space-y-1">
        <label className="text-xs font-medium">External identifier</label>
        <Input
          value={externalID}
          onChange={(e) => setExternalID(e.target.value)}
          placeholder="Telegram user id, email address, Slack user id…"
        />
      </div>
      <div className="space-y-1">
        <label className="text-xs font-medium">Display name (optional)</label>
        <Input
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder="Alice"
        />
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          size="sm"
          disabled={!externalID.trim() || create.isPending}
          onClick={() => {
            setError(null);
            create.mutate();
          }}
        >
          {create.isPending ? "Adding…" : "Add"}
        </Button>
      </div>
    </div>
  );
}
