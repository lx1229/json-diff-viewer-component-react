import React, { useMemo, useRef, useState } from "react";
// you can use other ui component to replace antd
import { Switch } from 'antd'

type DiffType = "unchanged" | "added" | "removed" | "modified";

const TYPE: Record<Uppercase<DiffType>, DiffType> = {
  UNCHANGED: "unchanged",
  ADDED: "added",
  REMOVED: "removed",
  MODIFIED: "modified",
} as const;

type DiffNode = {
  key: string | number;
  type: DiffType;
  left: unknown;
  right: unknown;
  hasDiff: boolean;
  children?: DiffNode[];
  isArray?: boolean;
  isObject?: boolean;
};

type Props = {
  left?: unknown;
  right?: unknown;
  className?: string;
};

const typeOf = (v: unknown) => {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  return typeof v;
};

const isObj = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object";

const allKeys = (a: unknown, b: unknown) => {
  const aKeys = isObj(a) ? Object.keys(a) : [];
  const bKeys = isObj(b) ? Object.keys(b) : [];
  return [...new Set([...aKeys, ...bKeys])];
};

const createNode = (
  key: string | number,
  type: DiffType,
  left: unknown,
  right: unknown,
  extra: Partial<DiffNode> = {}
): DiffNode => ({
  key,
  type,
  left,
  right,
  hasDiff: type !== TYPE.UNCHANGED,
  ...extra,
});

const getContainerProps = (val: unknown) => {
  if (Array.isArray(val)) return { isArray: true };
  if (isObj(val)) return { isObject: true };
  return {};
};

const mapChildrenForSide = (val: unknown, side: "added" | "removed"): DiffNode[] => {
  const type = side === "added" ? TYPE.ADDED : TYPE.REMOVED;

  const createChildNode = (value: unknown, key: string | number) => {
    const leftValue = side === "added" ? undefined : value;
    const rightValue = side === "added" ? value : undefined;
    const childExtra = isObj(value)
      ? {
        children: mapChildrenForSide(value, side),
        ...getContainerProps(value),
      }
      : {};
    return createNode(key, type, leftValue, rightValue, childExtra);
  };

  if (Array.isArray(val)) return val.map((item, index) => createChildNode(item, index));
  if (isObj(val)) return Object.entries(val).map(([k, v]) => createChildNode(v, k));
  return [];
};

const stringifyForKey = (v: unknown) => {
  try {
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return String(v);
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
};

const diffArray = (left: unknown[], right: unknown[]) => {
  // Prefer matching items by stable identifiers to avoid index-shift false positives.
  // Falls back to index-based diff when no stable key is found.
  const stableKeyForItem = (item: unknown): string | undefined => {
    if (!isObj(item) || Array.isArray(item)) return undefined;
    const obj = item as Record<string, unknown>;
    // sort key for jsonObject array with customerized key-values
    const target_key_list = [
      "name",
      "id"
    ];

    for (const k of target_key_list) {
      const v = obj[k];
      if (v !== undefined && v !== null && (typeof v === "string" || typeof v === "number")) {
        return `${k}:${String(v)}`;
      }
    }
    return undefined;
  };

  const leftKeys = left.map(stableKeyForItem);
  const rightKeys = right.map(stableKeyForItem);
  const hasStable = leftKeys.some(Boolean) || rightKeys.some(Boolean);

  if (!hasStable) {
    return Array.from({ length: Math.max(left.length, right.length) }, (_, i) => diff(left[i], right[i], i));
  }

  const toOccurrenceMap = (arr: unknown[]) => {
    const counts = new Map<string, number>();
    return arr.map((item, idx) => {
      const baseKey = stableKeyForItem(item) ?? `@idx:${idx}:${stringifyForKey(item)}`;
      const nth = counts.get(baseKey) ?? 0;
      counts.set(baseKey, nth + 1);
      return { key: `${baseKey}#${nth}`, item, idx };
    });
  };

  const leftEntries = toOccurrenceMap(left);
  const rightEntries = toOccurrenceMap(right);
  const leftMap = new Map(leftEntries.map((entry) => [entry.key, entry]));
  const rightMap = new Map(rightEntries.map((entry) => [entry.key, entry]));

  const all = new Set<string>([...leftMap.keys(), ...rightMap.keys()]);
  const sortedKeys = [...all].sort((a, b) => {
    const aIdx = leftMap.get(a)?.idx ?? rightMap.get(a)?.idx ?? 0;
    const bIdx = leftMap.get(b)?.idx ?? rightMap.get(b)?.idx ?? 0;
    return aIdx - bIdx;
  });

  return sortedKeys.map((k) => diff(leftMap.get(k)?.item, rightMap.get(k)?.item, k));
};

const diffModifierConfigArray = (left: unknown[], right: unknown[]) => {
  const normalizeStr = (v: unknown) => (typeof v === "string" ? v.trim() : "");

  const normalizeStringArray = (v: unknown, sort = false): string[] => {
    if (!Array.isArray(v)) return [];
    const arr = v
      .map((item) => normalizeStr(item))
      .filter((item) => item.length > 0);
    if (!sort) return arr;
    return [...arr].sort((a, b) => a.localeCompare(b));
  };

  const stableStringify = (value: unknown): string => {
    if (Array.isArray(value)) {
      return `[${value.map(stableStringify).join(",")}]`;
    }
    if (isObj(value)) {
      const obj = value as Record<string, unknown>;
      const keys = Object.keys(obj).sort((a, b) => a.localeCompare(b));
      return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
    }
    return JSON.stringify(value);
  };

  const modifierNameOf = (item: unknown): string | undefined => {
    if (!isObj(item) || Array.isArray(item)) return undefined;
    const name = normalizeStr((item as Record<string, unknown>).modifierName);
    return name || undefined;
  };

  const fallbackKeyForModifier = (item: unknown): string | undefined => {
    if (!isObj(item) || Array.isArray(item)) return undefined;
    const obj = item as Record<string, unknown>;

    const buildInModifierFuncName = normalizeStr(obj.buildInModifierFuncName);
    const inputColumns = normalizeStringArray(obj.modifierInputColumns, true).join(",");
    const outputColumns = normalizeStringArray(obj.modifierOutputColumns, true).join(",");
    const modifierType = normalizeStr(obj.modifierType);



    if (buildInModifierFuncName || modifierType || inputColumns || outputColumns) {
      return [
        `func:${buildInModifierFuncName}`,
        `type:${modifierType}`,
        `in:${inputColumns}`,
        `out:${outputColumns}`
      ].join("|");
    }

    const dependencies = normalizeStringArray(obj.dependencies, true).join(",");
    const ctorParams = obj.modifierCtorParams === undefined ? "" : stableStringify(obj.modifierCtorParams);

    if (dependencies || ctorParams) {
      return [`deps:${dependencies}`, `ctor:${ctorParams}`].join("|");
    }

    return undefined;
  };

  const displayKeyForModifier = (item: unknown) => {
    if (!isObj(item) || Array.isArray(item)) return "modifier";
    const obj = item as Record<string, unknown>;
    const buildInModifierFuncName = normalizeStr(obj.buildInModifierFuncName);
    if (buildInModifierFuncName) return `buildInModifierFuncName:${buildInModifierFuncName}`;
    const modifierName = normalizeStr(obj.modifierName);
    if (modifierName) return `func:${modifierName}`;
    return "buildInModifierFuncName";
  };

  type Entry = {
    item: unknown;
    idx: number;
    modifierName?: string;
    fallbackKey?: string;
    displayBase: string;
  };

  const leftEntries: Entry[] = left.map((item, idx) => ({
    item,
    idx,
    modifierName: modifierNameOf(item),
    fallbackKey: fallbackKeyForModifier(item),
    displayBase: displayKeyForModifier(item),
  }));

  const rightEntries: Entry[] = right.map((item, idx) => ({
    item,
    idx,
    modifierName: modifierNameOf(item),
    fallbackKey: fallbackKeyForModifier(item),
    displayBase: displayKeyForModifier(item),
  }));

  type Pair = { leftItem?: unknown; rightItem?: unknown; displayKey: string; sortIdx: number };
  const pairs: Pair[] = [];

  // Rule: if modifierName exists, bind strictly one-to-one by modifierName only.
  // Never fall back to other keys for these records.
  const rightNamedBuckets = new Map<string, Entry[]>();
  rightEntries.forEach((entry) => {
    if (!entry.modifierName) return;
    const bucket = rightNamedBuckets.get(entry.modifierName) ?? [];
    bucket.push(entry);
    rightNamedBuckets.set(entry.modifierName, bucket);
  });

  const pickBestRightEntry = (leftEntry: Entry, bucket: Entry[]): Entry | undefined => {
    if (!bucket.length) return undefined;

    let bestIdx = -1;
    let bestScore: [number, number, number] | undefined;

    for (let i = 0; i < bucket.length; i++) {
      const candidate = bucket[i];
      const fallbackMismatch = leftEntry.fallbackKey && candidate.fallbackKey
        ? (leftEntry.fallbackKey === candidate.fallbackKey ? 0 : 1)
        : 1;
      const distance = Math.abs(leftEntry.idx - candidate.idx);
      const score: [number, number, number] = [fallbackMismatch, distance, candidate.idx];

      if (
        !bestScore ||
        score[0] < bestScore[0] ||
        (score[0] === bestScore[0] && score[1] < bestScore[1]) ||
        (score[0] === bestScore[0] && score[1] === bestScore[1] && score[2] < bestScore[2])
      ) {
        bestScore = score;
        bestIdx = i;
      }
    }

    if (bestIdx < 0) return undefined;
    const [picked] = bucket.splice(bestIdx, 1);
    return picked;
  };

  const nameOccurrence = new Map<string, number>();
  leftEntries.forEach((leftEntry) => {
    if (!leftEntry.modifierName) return;
    const name = leftEntry.modifierName;
    const bucket = rightNamedBuckets.get(name);
    const rightEntry = bucket ? pickBestRightEntry(leftEntry, bucket) : undefined;
    const nth = (nameOccurrence.get(name) ?? 0) + 1;
    nameOccurrence.set(name, nth);

    pairs.push({
      leftItem: leftEntry.item,
      rightItem: rightEntry?.item,
      displayKey: `buildInModifierFuncName:${name}#${nth}`,
      sortIdx: Math.min(leftEntry.idx, rightEntry?.idx ?? leftEntry.idx),
    });
  });

  rightNamedBuckets.forEach((bucket, name) => {
    bucket.forEach((rightEntry) => {
      const nth = (nameOccurrence.get(name) ?? 0) + 1;
      nameOccurrence.set(name, nth);
      pairs.push({
        rightItem: rightEntry.item,
        displayKey: `modifierName:${name}#${nth}`,
        sortIdx: rightEntry.idx,
      });
    });
  });

  const leftUnnamed = leftEntries.filter((entry) => !entry.modifierName);
  const rightUnnamed = rightEntries.filter((entry) => !entry.modifierName);

  const toOccurrenceMap = (arr: Entry[]) => {
    const counts = new Map<string, number>();
    return arr.map((entry) => {
      const baseKey = entry.fallbackKey ?? `@idx:${entry.idx}:${stringifyForKey(entry.item)}`;
      const nth = counts.get(baseKey) ?? 0;
      counts.set(baseKey, nth + 1);
      return {
        key: `${baseKey}#${nth}`,
        displayKey: `${entry.displayBase}#${nth + 1}`,
        item: entry.item,
        idx: entry.idx,
      };
    });
  };

  const leftUnnamedMap = new Map(toOccurrenceMap(leftUnnamed).map((entry) => [entry.key, entry]));
  const rightUnnamedMap = new Map(toOccurrenceMap(rightUnnamed).map((entry) => [entry.key, entry]));
  const unnamedKeys = new Set<string>([...leftUnnamedMap.keys(), ...rightUnnamedMap.keys()]);

  [...unnamedKeys]
    .sort((a, b) => {
      const aIdx = leftUnnamedMap.get(a)?.idx ?? rightUnnamedMap.get(a)?.idx ?? 0;
      const bIdx = leftUnnamedMap.get(b)?.idx ?? rightUnnamedMap.get(b)?.idx ?? 0;
      return aIdx - bIdx;
    })
    .forEach((k) => {
      const leftEntry = leftUnnamedMap.get(k);
      const rightEntry = rightUnnamedMap.get(k);
      pairs.push({
        leftItem: leftEntry?.item,
        rightItem: rightEntry?.item,
        displayKey: leftEntry?.displayKey ?? rightEntry?.displayKey ?? k,
        sortIdx: Math.min(leftEntry?.idx ?? Number.MAX_SAFE_INTEGER, rightEntry?.idx ?? Number.MAX_SAFE_INTEGER),
      });
    });

  return pairs
    .sort((a, b) => a.sortIdx - b.sortIdx)
    .map((pair) => diff(pair.leftItem, pair.rightItem, pair.displayKey));
};

const diffContainer = (left: unknown, right: unknown, key: string | number, isArr: boolean) => {
  const items = isArr
    ? (key === "modifierConfig"
      ? diffModifierConfigArray(Array.isArray(left) ? left : [], Array.isArray(right) ? right : [])
      : diffArray(Array.isArray(left) ? left : [], Array.isArray(right) ? right : []))
    : allKeys(left, right).map((k) =>
      diff(
        isObj(left) ? (left as Record<string, unknown>)[k] : undefined,
        isObj(right) ? (right as Record<string, unknown>)[k] : undefined,
        k
      )
    );
  const hasDiff = items.some((c) => c.hasDiff);
  return createNode(key, hasDiff ? TYPE.MODIFIED : TYPE.UNCHANGED, left, right, {
    children: items,
    ...getContainerProps(left),
  });
};

const sortJsonForDiff = (val: unknown, path = ""): unknown => {
  if (Array.isArray(val)) {
    const normalized = val.map((item) => sortJsonForDiff(item, path));
    if (path.endsWith(".modifierConfig") || path === "modifierConfig") return normalized;
    // If array items are objects with stable keys, sort by those keys to reduce noise
    const stableKeyForItem = (item: unknown): string | undefined => {
      if (!isObj(item) || Array.isArray(item)) return undefined;
      const obj = item as Record<string, unknown>;
      for (const k of ["id", "key", "name", "code", "rationaleCode"]) {
        const v = obj[k];
        if (v !== undefined && v !== null && (typeof v === "string" || typeof v === "number")) {
          return `${k}:${String(v)}`;
        }
      }
      return undefined;
    };

    const hasStable = normalized.some((i) => stableKeyForItem(i));
    if (!hasStable) return normalized;

    return [...normalized].sort((a, b) => {
      const ka = stableKeyForItem(a) ?? stringifyForKey(a);
      const kb = stableKeyForItem(b) ?? stringifyForKey(b);
      return ka.localeCompare(kb);
    });
  }

  if (isObj(val)) {
    const obj = val as Record<string, unknown>;
    const sortedKeys = Object.keys(obj).sort((a, b) => a.localeCompare(b));
    const out: Record<string, unknown> = {};
    sortedKeys.forEach((k) => {
      const childPath = path ? `${path}.${k}` : k;
      out[k] = sortJsonForDiff(obj[k], childPath);
    });
    return out;
  }

  return val;
};

const diff = (left: unknown, right: unknown, key: string | number = "root"): DiffNode => {
  if (left === undefined) {
    const extra = isObj(right)
      ? {
        children: mapChildrenForSide(right, "added"),
        ...getContainerProps(right),
      }
      : {};
    return createNode(key, TYPE.ADDED, left, right, extra);
  }
  if (right === undefined) {
    const extra = isObj(left)
      ? {
        children: mapChildrenForSide(left, "removed"),
        ...getContainerProps(left),
      }
      : {};
    return createNode(key, TYPE.REMOVED, left, right, extra);
  }
  if (!isObj(left) && !isObj(right)) {
    return createNode(key, left === right ? TYPE.UNCHANGED : TYPE.MODIFIED, left, right);
  }
  if (typeOf(left) !== typeOf(right)) {
    return createNode(key, TYPE.MODIFIED, left, right, {
      children: [],
      ...getContainerProps(left),
    });
  }
  return diffContainer(left, right, key, Array.isArray(left));
};

const format = (val: unknown): [string, "null" | "string" | "number" | "boolean"] => {
  if (val === null) return ["null", "null"];
  if (val === undefined) return ["undefined", "null"];
  const t = typeof val;
  if (t === "string") return [String(val), "string"];
  if (t === "number" || t === "boolean") return [String(val), t];
  return [JSON.stringify(val), "string"];
};

const buildPath = (path: string, key: string | number) => (path ? `${path}.${key}` : String(key));

const filterChildren = (children: DiffNode[], showOnlyChanged: boolean) =>
  showOnlyChanged ? children.filter((c) => c.hasDiff) : children;

const isExpanded = (expanded: Record<string, boolean>, path: string) => expanded[path] !== false;

const buildKey = (key: string | number, root: boolean, hidden = false) => {
  if (root) return null;
  const style = hidden ? { visibility: "hidden" as const } : undefined;
  return (
    <>
      <span className="key" style={style}>
        {key}
      </span>
      <span className="colon" style={style}>
        :
      </span>
    </>
  );
};

const getBrackets = (isArray?: boolean) => (isArray ? ["[", "]"] : ["{", "}"]);

const STAT_TYPES: DiffType[] = ["added", "removed", "modified"];

const collectStats = (tree: DiffNode) => {
  const stats: Record<DiffType, number> = {
    unchanged: 0,
    added: 0,
    removed: 0,
    modified: 0,
  };

  const walk = (node: DiffNode, path = "") => {
    const currentPath = buildPath(path, node.key);
    void currentPath;
    stats[node.type]++;
    (node.children || []).forEach((child) => walk(child, currentPath));
  };

  walk(tree);
  return stats;
};

const initializeExpanded = (tree: DiffNode) => {
  const expanded: Record<string, boolean> = {};
  const walk = (node: DiffNode, path = "") => {
    const currentPath = buildPath(path, node.key);
    if ((node.isArray || node.isObject) && !node.hasDiff) expanded[currentPath] = false;
    (node.children || []).forEach((child) => walk(child, currentPath));
  };
  walk(tree);
  return expanded;
};

const styles = `
.jdv {
  --add: #15803d; --rem: #b91c1c; --mod: #ca8a04;
  --bg: #f4f4f4; --bg2: #f9fafb; --bdr: #d1d5db;
  --txt: #030712; --dim: #4b5563;
  --key: #075985; --str: #6d28d9; --num: #047857; --bool: #b45309; --nul: #a21caf; --br: #6b7280;
  --slider: #d1d5db;
  display: flex; flex-direction: column; font: 13px 'JetBrains Mono', 'Fira Code', monospace;
  background: var(--bg); color: var(--txt); border-radius: 12px; overflow: hidden;
}
.jdv * { box-sizing: border-box; margin: 0; padding: 0; }
.jdv .stats { position: sticky; top: 0; z-index: 10; }
.jdv .container { display: grid; grid-template-columns: 1fr 1fr; flex: 1; min-height: 0; }
.jdv .panel { overflow: auto; padding: 1rem; background: var(--bg2); scrollbar-width: thin; scrollbar-color: var(--bdr) transparent; }
.jdv .panel:first-child { border-right: 2px solid var(--bdr); }
.jdv .node { padding-left: 1.25rem; }
.jdv .node.root { padding-left: 0; }
.jdv .line { display: flex; align-items: flex-start; gap: 0.5rem; padding: 2px 4px; border-radius: 4px; cursor: pointer; transition: background .15s; white-space: pre; }
.jdv .line:hover { background: rgba(0,0,0,.03); }
.jdv .line.placeholder { cursor: default; pointer-events: none; }
.jdv .line.placeholder:hover { background: transparent; }
.jdv .tog { width: 1rem; flex-shrink: 0; color: var(--br); user-select: none; }
.jdv .tog:hover { color: var(--txt); }
.jdv .key { color: var(--key); }
.jdv .colon { color: var(--dim); margin-right: 0.25rem; }
.jdv .val-string { color: var(--str); }
.jdv .val-string::before, .jdv .val-string::after { content: '"'; }
.jdv .val-number { color: var(--num); }
.jdv .val-boolean { color: var(--bool); }
.jdv .val-null { color: var(--nul); font-style: italic; }
.jdv .br { color: var(--br); }
.jdv .node.diff-added { background: rgba(34,197,94,.15); }
.jdv .node.diff-removed { background: rgba(239,68,68,.15); }
.jdv .node.diff-modified { background: rgba(234,179,8,.15); }
.jdv .node.diff-added .key { color: var(--add); }
.jdv .node.diff-removed .key { color: var(--rem); }
.jdv .node.diff-modified .key { color: var(--mod); }
.jdv .dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; margin-top: 6px; }
.jdv .dot-added { background: var(--add); }
.jdv .dot-removed { background: var(--rem); }
.jdv .dot-modified { background: var(--mod); }
.jdv .preview { color: var(--dim); font-style: italic; }
.jdv .preview::before { content: ' '; }
.jdv .preview::after { content: ' items'; }
.jdv .stats { display: grid; grid-template-columns: 1fr auto; align-items: center; gap: 1rem; padding: .75rem 1rem; background: var(--bg); border-bottom: 2px solid var(--bdr); font-size: 12px; }
.jdv .stats-items { display: grid; grid-auto-flow: column; gap: 2rem; justify-content: start; }
.jdv .stats-buttons { display: flex; gap: 0.5rem; align-items: center; }
.jdv .switch { display: inline-block; cursor: pointer; }
.jdv .checkbox { display: none; }
.jdv .slider { width: 48px; height: 24px; background-color: var(--bdr); border-radius: 16px; overflow: hidden; display: flex; align-items: center; border: 3px solid transparent; transition: .3s; box-shadow: 0 0 10px 0 rgba(0, 0, 0, 0.25) inset; cursor: pointer; }
.jdv .slider::before { content: ''; display: block; width: 100%; height: 100%; background-color: var(--br); transform: translateX(-24px); border-radius: 16px; transition: .3s; box-shadow: 0 0 10px 3px rgba(0, 0, 0, 0.25); }
.jdv .checkbox:checked ~ .slider::before { transform: translateX(24px); box-shadow: 0 0 10px 3px rgba(0, 0, 0, 0.25); }
.jdv .checkbox:checked ~ .slider { background-color: var(--slider); }
.jdv .checkbox:active ~ .slider::before { transform: translate(0); }
.jdv .btn-collapse, .jdv .btn-expand { padding: 0.5rem; background: var(--bg2); border: 1px solid var(--bdr); border-radius: 10px; color: var(--txt); cursor: pointer; transition: background .15s, border-color .15s; display: flex; align-items: center; justify-content: center; }
.jdv .btn-collapse svg, .jdv .btn-expand svg { width: 18px; height: 18px; }
.jdv .btn-collapse:hover, .jdv .btn-expand:hover { background: rgba(0,0,0,.05); box-shadow: 0 0 4px var(--bdr); }
.jdv .stat { display: grid; grid-template-columns: auto 1fr; align-items: baseline; gap: .35rem; }
.jdv .stat .dot { width: 8px; height: 8px; }
.jdv .stat-added .dot { background: var(--add); }
.jdv .stat-removed .dot { background: var(--rem); }
.jdv .stat-modified .dot { background: var(--mod); }
.jdv .empty { padding: 2rem; color: var(--dim); }
`;

const JsonDiffViewer = ({ left, right, className }: Props) => {
  const tree = useMemo(() => {
    if (left === undefined || right === undefined) return null;
    const leftSorted = sortJsonForDiff(left, "root");
    const rightSorted = sortJsonForDiff(right, "root");
    return diff(leftSorted, rightSorted);
  }, [left, right]);

  const stats = useMemo(() => {
    if (!tree) return null;
    return collectStats(tree);
  }, [tree]);

  const [showOnlyChanged, setShowOnlyChanged] = useState(true);

  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const expandedRef = useRef(expanded);
  expandedRef.current = expanded;

  const leftPanelRef = useRef<HTMLDivElement | null>(null);
  const rightPanelRef = useRef<HTMLDivElement | null>(null);
  const syncingRef = useRef(false);

  React.useEffect(() => {
    if (!tree) return;
    setExpanded(initializeExpanded(tree));
  }, [tree]);

  const collapseAll = () => {
    if (!tree) return;
    const next: Record<string, boolean> = { ...expandedRef.current };

    const walk = (node: DiffNode, path = "") => {
      const currentPath = buildPath(path, node.key);
      if (node.isArray || node.isObject) next[currentPath] = false;
      (node.children || []).forEach((child) => walk(child, currentPath));
    };

    walk(tree);
    setExpanded(next);
  };

  const expandAll = () => {
    setExpanded({});
  };

  const togglePath = (p: string) => {
    setExpanded((prev) => ({
      ...prev,
      [p]: prev[p] === false,
    }));
  };

  const onScroll = (source: "left" | "right") => () => {
    const sourceEl = source === "left" ? leftPanelRef.current : rightPanelRef.current;
    const targetEl = source === "left" ? rightPanelRef.current : leftPanelRef.current;
    if (!sourceEl || !targetEl) return;

    if (syncingRef.current) return;
    syncingRef.current = true;
    targetEl.scrollTop = sourceEl.scrollTop;
    targetEl.scrollLeft = sourceEl.scrollLeft;
    syncingRef.current = false;
  };

  const renderNode = (
    node: DiffNode,
    side: "left" | "right",
    path: string,
    root = true,
    placeholderParam = false
  ): React.ReactNode => {
    const currentPath = buildPath(path, node.key);
    const value = node[side];
    const rootClass = root ? " root" : "";
    const placeholder = value === undefined && node.children?.length ? true : placeholderParam;

    if (value === undefined && !node.children?.length) {
      const otherValue = side === "left" ? node.right : node.left;
      const [val, type] = format(otherValue);
      return (
        <div className={`node${rootClass}`} key={`${side}:${currentPath}:missing`}>
          <div className="line placeholder">
            {buildKey(node.key, root, true)}
            <span className={`val-${type}`} style={{ visibility: "hidden" }}>
              {val}
            </span>
          </div>
        </div>
      );
    }

    if (value !== undefined && !node.isArray && !node.isObject) {
      const [val, type] = format(value);
      if (placeholder) {
        return (
          <div className={`node${rootClass}`} key={`${side}:${currentPath}:prim:ph`}>
            <div className="line placeholder">
              {buildKey(node.key, root, false)}
              <span className={`val-${type}`} style={{ visibility: "hidden" }}>
                {val}
              </span>
            </div>
          </div>
        );
      }

      const hasDiff = node.hasDiff && node.type !== TYPE.UNCHANGED;
      const nodeDiffClass = hasDiff ? ` diff-${node.type}` : "";
      return (
        <div className={`node${rootClass}${nodeDiffClass}`} key={`${side}:${currentPath}:prim`}>
          <div className="line">
            <span className="tog" />
            {buildKey(node.key, root, false)}
            <span className={`val-${type}`}>{val}</span>
          </div>
        </div>
      );
    }

    const [open, close] = getBrackets(node.isArray);
    const expandedNow = isExpanded(expandedRef.current, currentPath);
    const children = node.children || [];
    const filtered = filterChildren(children, showOnlyChanged);
    const preview = `${filtered.length}`;

    if (placeholder) {
      if (!expandedNow) {
        return (
          <div className={`node${rootClass}`} key={`${side}:${currentPath}:cont:ph:collapsed`}>
            <div className="line placeholder">
              {buildKey(node.key, root, false)}
              <span className="br" style={{ visibility: "hidden" }}>
                {open}
              </span>
              <span className="preview" style={{ visibility: "hidden" }}>
                {preview}
              </span>
              <span className="br" style={{ visibility: "hidden" }}>
                {close}
              </span>
            </div>
          </div>
        );
      }

      return (
        <div className={`node${rootClass}`} key={`${side}:${currentPath}:cont:ph:expanded`}>
          <div className="line placeholder">
            {buildKey(node.key, root, false)}
            <span className="br" style={{ visibility: "hidden" }}>
              {open}
            </span>
          </div>
          {filtered.map((c) => renderNode(c, side, currentPath, false, placeholder))}
          <div className="line placeholder">
            <span className="br" style={{ visibility: "hidden" }}>
              {close}
            </span>
          </div>
        </div>
      );
    }

    const hasDiff = node.hasDiff && node.type !== TYPE.UNCHANGED;
    const hasChildDiff = node.hasDiff && children.some((c) => c.hasDiff);
    const dotType = node.type === TYPE.UNCHANGED ? "modified" : node.type;
    const dot = hasChildDiff ? <span className={`dot dot-${dotType}`} /> : null;
    const nodeDiffClass = hasDiff && !hasChildDiff ? ` diff-${node.type}` : "";
    const toggle = expandedNow ? "▼" : "▶";

    if (!expandedNow) {
      return (
        <div className={`node${rootClass}${nodeDiffClass}`} key={`${side}:${currentPath}:cont:collapsed`}>
          <div className="line" onClick={() => togglePath(currentPath)}>
            <span className="tog">{toggle}</span>
            {dot}
            {buildKey(node.key, root, false)}
            <span className="br">{open}</span>
            <span className="preview">{preview}</span>
            <span className="br">{close}</span>
          </div>
        </div>
      );
    }

    return (
      <div className={`node${rootClass}${nodeDiffClass}`} key={`${side}:${currentPath}:cont:expanded`}>
        <div className="line" onClick={() => togglePath(currentPath)}>
          <span className="tog">{toggle}</span>
          {dot}
          {buildKey(node.key, root, false)}
          <span className="br">{open}</span>
        </div>
        {filtered.map((c) => renderNode(c, side, currentPath, false, placeholder))}
        <div className="line">
          <span className="tog" />
          <span className="br">{close}</span>
        </div>
      </div>
    );
  };

  if (!tree || !stats) {
    return (
      <div className={`jdv${className ? ` ${className}` : ""}`}>
        <style>{styles}</style>
        <div className="empty">Provide left and right JSON</div>
      </div>
    );
  }

  return (
    <div className={`jdv${className ? ` ${className}` : ""}`}>
      <style>{styles}</style>
      <div className="stats">
        <div className="stats-items">
          {STAT_TYPES.map((t) => (
            <div className={`stat stat-${t}`} key={t}>
              <span className="dot" />
              {stats[t]} {t.replace("_", " ")}
            </div>
          ))}
        </div>
        <div className="stats-buttons">
          <Switch checkedChildren="Show Changes"
            unCheckedChildren="Show All"
            checked={showOnlyChanged}
            onChange={() => setShowOnlyChanged(!showOnlyChanged)} />
          <button className="btn-collapse" onClick={collapseAll} title="Collapse all" type="button">
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">
              <path
                fill="currentColor"
                d="M9 15H6q-.425 0-.712-.288T5 14t.288-.712T6 13h4q.425 0 .713.288T11 14v4q0 .425-.288.713T10 19t-.712-.288T9 18zm6-6h3q.425 0 .713.288T19 10t-.288.713T18 11h-4q-.425 0-.712-.288T13 10V6q0-.425.288-.712T14 5t.713.288T15 6z"
              />
            </svg>
          </button>
          <button className="btn-expand" onClick={expandAll} title="Expand all" type="button">
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">
              <path
                fill="currentColor"
                d="M7 17h3q.425 0 .713.288T11 18t-.288.713T10 19H6q-.425 0-.712-.288T5 18v-4q0-.425.288-.712T6 13t.713.288T7 14zM17 7h-3q-.425 0-.712-.288T13 6t.288-.712T14 5h4q.425 0 .713.288T19 6v4q0 .425-.288.713T18 11t-.712-.288T17 10z"
              />
            </svg>
          </button>
        </div>
      </div>

      <div className="container">
        <div className="panel" ref={leftPanelRef} onScroll={onScroll("left")}>
          {renderNode(tree, "left", "")}
        </div>
        <div className="panel" ref={rightPanelRef} onScroll={onScroll("right")}>
          {renderNode(tree, "right", "")}
        </div>
      </div>
    </div>
  );
}


export default JsonDiffViewer;