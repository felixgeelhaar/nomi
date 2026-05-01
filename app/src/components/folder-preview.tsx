import { useState, useCallback } from "react";
import { ChevronRight, ChevronDown, Folder, File } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface FileNode {
  name: string;
  type: "file" | "directory";
  size?: number;
  children?: FileNode[];
}

interface FileTreeProps {
  node: FileNode;
  depth?: number;
}

function FileTreeNode({ node, depth = 0 }: FileTreeProps) {
  const [expanded, setExpanded] = useState(depth < 1);
  const isDir = node.type === "directory";

  const toggle = useCallback(() => {
    if (isDir) setExpanded((e) => !e);
  }, [isDir]);

  return (
    <div>
      <div
        className="flex items-center gap-1 py-0.5 hover:bg-muted/50 rounded cursor-pointer select-none"
        style={{ paddingLeft: `${depth * 16}px` }}
        onClick={toggle}
      >
        {isDir ? (
          <>
            {expanded ? (
              <ChevronDown className="w-3 h-3 text-muted-foreground" />
            ) : (
              <ChevronRight className="w-3 h-3 text-muted-foreground" />
            )}
            <Folder className="w-3.5 h-3.5 text-blue-500" />
          </>
        ) : (
          <>
            <span className="w-3" />
            <File className="w-3.5 h-3.5 text-muted-foreground" />
          </>
        )}
        <span className="text-xs">{node.name}</span>
        {node.size !== undefined && node.size > 0 && (
          <span className="text-[10px] text-muted-foreground ml-1">
            ({formatSize(node.size)})
          </span>
        )}
      </div>
      {isDir && expanded && node.children && (
        <div>
          {node.children.map((child, i) => (
            <FileTreeNode key={`${child.name}-${i}`} node={child} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

export interface FolderPreviewProps {
  path: string;
  tree?: FileNode;
  stats?: {
    file_count: number;
    dir_count: number;
    total_size: number;
  };
  onRefresh?: () => void;
  loading?: boolean;
}

export function FolderPreview({ path, tree, stats, onRefresh, loading }: FolderPreviewProps) {
  if (loading) {
    return (
      <div className="border rounded-md p-3 bg-muted/30">
        <div className="text-xs text-muted-foreground animate-pulse">Loading folder preview...</div>
      </div>
    );
  }

  if (!tree) {
    return (
      <div className="border rounded-md p-3 bg-muted/30">
        <div className="text-xs text-muted-foreground">No preview available</div>
      </div>
    );
  }

  return (
    <div className="border rounded-md p-3 space-y-2 bg-muted/30">
      <div className="flex items-center justify-between">
        <div className="text-xs font-medium text-muted-foreground truncate" title={path}>
          {path}
        </div>
        {onRefresh && (
          <Button type="button" variant="ghost" size="sm" className="h-6 px-2" onClick={onRefresh}>
            Refresh
          </Button>
        )}
      </div>
      {stats && (
        <div className="flex gap-3 text-[10px] text-muted-foreground">
          <span>{stats.file_count} files</span>
          <span>{stats.dir_count} dirs</span>
          <span>{formatSize(stats.total_size)}</span>
        </div>
      )}
      <div className="max-h-[200px] overflow-y-auto border rounded bg-background p-2">
        <FileTreeNode node={tree} />
      </div>
    </div>
  );
}
