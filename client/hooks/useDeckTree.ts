import { useState, useEffect, useCallback, useRef } from 'react';
import { getTree, type TreeResponse, type TreeHashResponse } from '@/lib/api';
import type { TreeNode } from '@/lib/types';
import * as Crypto from 'expo-crypto';

async function sha256(data: string): Promise<string> {
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, data);
}

export function useDeckTree(active: boolean): {
  tree: TreeNode[];
  loading: boolean;
  refreshing: boolean;
  newDecksStartedToday: number;
  refresh: () => Promise<void>;
} {
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [newDecksStartedToday, setNewDecksStartedToday] = useState(0);
  const [uiDataHash, setUiDataHash] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const manualRef = useRef(false);

  const fetchFullData = useCallback(async (signal?: AbortSignal) => {
    const result = await getTree(signal, false) as TreeResponse;
    if (signal?.aborted) return;
    setTree(result.tree);
    setNewDecksStartedToday(result.newDecksStartedToday);
    const hash = await sha256(JSON.stringify({ tree: result.tree, newDecksStartedToday: result.newDecksStartedToday }));
    setUiDataHash(hash);
  }, []);

  const doFetch = useCallback(async (signal?: AbortSignal, hashOnly?: boolean) => {
    try {
      if (hashOnly) {
        const result = await getTree(signal, true) as TreeHashResponse;
        if (signal?.aborted) return;
        if (result.hash !== uiDataHash) {
          await fetchFullData(signal);
        }
        return;
      }
      await fetchFullData(signal);
    } catch {
      console.error('Failed to fetch deck tree');
    } finally {
      if (!signal?.aborted) {
        setLoading(false);
        if (manualRef.current) {
          manualRef.current = false;
          setRefreshing(false);
        }
      }
    }
  }, [uiDataHash, fetchFullData]);

  const refresh = useCallback(async () => {
    manualRef.current = true;
    setRefreshing(true);
    await doFetch(undefined, false);
  }, [doFetch]);

  useEffect(() => {
    if (!active) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }
    const controller = new AbortController();
    doFetch(controller.signal, false);
    intervalRef.current = setInterval(() => doFetch(controller.signal, true), 5000);
    return () => {
      controller.abort();
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [active, doFetch]);

  return { tree, loading, refreshing, newDecksStartedToday, refresh };
}
