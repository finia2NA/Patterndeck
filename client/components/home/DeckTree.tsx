import { useState, useCallback, useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, Animated } from 'react-native';
import type { TreeNode } from '@/lib/types';
import { AnimatedCollapsible } from '@/components/AnimatedCollapsible';
import { getCollapsedNodes, setCollapsedNodes } from '@/lib/storage';
import { Icon } from '@/components/Icon';
import { DueIndicator } from '@/components/home/DueIndicator';
import { useColors } from '@/constants/theme';

interface DeckTreeProps {
  tree: TreeNode[];
  onStudy: (node: TreeNode) => void;
  onEdit: (node: TreeNode) => void;
  onHistory: (node: TreeNode) => void;
}

export function DeckTree({ tree, onStudy, onEdit, onHistory }: DeckTreeProps) {
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set());
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    getCollapsedNodes().then(ids => {
      setCollapsedIds(ids);
      setLoaded(true);
    });
  }, []);

  const toggleCollapsed = useCallback((id: string) => {
    setCollapsedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      setCollapsedNodes(next);
      return next;
    });
  }, []);

  if (tree.length === 0) {
    return (
      <View className="items-center py-16 px-8">
        <Text className="text-foreground-secondary text-base text-center leading-6">
          No decks yet.{'\n'}Use New Deck or + to create your first deck.
        </Text>
      </View>
    );
  }

  if (!loaded) return null;

  return (
    <View>
      {tree.map(node => (
        <TreeRow
          key={node.id}
          node={node}
          depth={0}
          collapsedIds={collapsedIds}
          onToggle={toggleCollapsed}
          onStudy={onStudy}
          onEdit={onEdit}
          onHistory={onHistory}
        />
      ))}
    </View>
  );
}

// ─── Tree row ─────────────────────────────────────────────────────────────────

interface TreeRowProps {
  node: TreeNode;
  depth: number;
  collapsedIds: Set<string>;
  onToggle: (id: string) => void;
  onStudy: (node: TreeNode) => void;
  onEdit: (node: TreeNode) => void;
  onHistory: (node: TreeNode) => void;
}

function TreeRow({ node, depth, collapsedIds, onToggle, onStudy, onEdit, onHistory }: TreeRowProps) {
  const isCollection = node.deck === null;
  const expanded = !collapsedIds.has(node.id);
  const colors = useColors();

  return (
    <View>
      <View className="flex-row items-center" style={{ paddingLeft: depth * 20 }}>
        {/* Chevron / bullet */}
        {isCollection ? (
          <TouchableOpacity onPress={() => onToggle(node.id)} className="w-8 h-10 items-center justify-center">
            <Icon
              name={expanded ? 'chevron-down' : 'chevron-right'}
              size={14}
              color={colors.foreground_secondary}
            />
          </TouchableOpacity>
        ) : (
          <View className="w-8 h-10 items-center justify-center">
            <Icon name="bullet" size={9} color={colors.foreground_secondary} />
          </View>
        )}

        {/* Name — tappable to study */}
        <TouchableOpacity
          className="flex-1 h-10 justify-center"
          onPress={() => onStudy(node)}
          activeOpacity={0.6}
        >
          <Text
            className={`text-foreground text-base ${isCollection ? 'font-semibold' : ''}`}
            numberOfLines={1}
          >
            {node.name}
          </Text>
        </TouchableOpacity>

        {/* Due indicator — deck rows; spacer keeps buttons aligned on collection rows */}
        {!isCollection && node.deck
          ? <DueIndicator dueAt={node.deck.dueAt ?? null} isDue={node.deck.isDue ?? false} />
          : <View style={{ width: 72 }} />
        }

        {/* Explanation generating spinner */}
        {!isCollection && <StatusBadge status={node.deck!.explanationStatus} />}

        {/* History button — spacer when not applicable keeps edit button aligned */}
        {(!isCollection && node.deck?.dueAt != null) || (isCollection && node.children.length > 0)
          ? (
            <TouchableOpacity
              className="w-10 h-10 items-center justify-center"
              onPress={() => onHistory(node)}
              activeOpacity={0.6}
            >
              <Icon name="clock" size={15} color={colors.foreground_secondary} />
            </TouchableOpacity>
          ) : (
            <View className="w-10" />
          )
        }

        {/* Edit button */}
        <TouchableOpacity
          className="w-10 h-10 items-center justify-center"
          onPress={() => onEdit(node)}
          activeOpacity={0.6}
        >
          <Icon name="pencil" size={16} color={colors.foreground_secondary} />
        </TouchableOpacity>
      </View>

      {/* Children */}
      {isCollection && (
        <AnimatedCollapsible expanded={expanded} keepMounted={false}>
          <View>
            {node.children.map(child => (
              <TreeRow
                key={child.id}
                node={child}
                depth={depth + 1}
                collapsedIds={collapsedIds}
                onToggle={onToggle}
                onStudy={onStudy}
                onEdit={onEdit}
                onHistory={onHistory}
              />
            ))}
          </View>
        </AnimatedCollapsible>
      )}
    </View>
  );
}

// ─── Status badge ─────────────────────────────────────────────────────────────

function PendingDot({ color }: { color: string }) {
  const opacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.2, duration: 700, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1, duration: 700, useNativeDriver: true }),
      ])
    );
    anim.start();
    return () => anim.stop();
  }, [opacity]);

  return (
    <Animated.View style={{ opacity, width: 7, height: 7, borderRadius: 4, backgroundColor: color }} />
  );
}

function StatusBadge({ status }: { status: string }) {
  const colors = useColors();
  switch (status) {
    case 'generating':
      return (
        // @ts-ignore — title is valid on web View for hover tooltip
        <View style={{ paddingHorizontal: 6 }} title="Explanation generating">
          <ActivityIndicator size={10} color={colors.primary} />
        </View>
      );
    case 'pending':
      return (
        // @ts-ignore — title is valid on web View for hover tooltip
        <View style={{ paddingHorizontal: 6, justifyContent: 'center' }} title="Explanation generation queued">
          <PendingDot color={colors.primary} />
        </View>
      );
    case 'error':
      return (
        // @ts-ignore — title is valid on web View for hover tooltip
        <View style={{ paddingHorizontal: 6, justifyContent: 'center' }} title="Explanation generation failed">
          <Icon name="warning" size={12} color={colors.error} />
        </View>
      );
    default:
      return null;
  }
}
