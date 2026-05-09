import React, { useState, useCallback, useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, Animated } from 'react-native';
import type { TreeNode } from '@/lib/types';
import { AnimatedCollapsible } from '@/components/AnimatedCollapsible';
import { getCollapsedNodes, setCollapsedNodes } from '@/lib/storage';
import { Icon } from '@/components/Icon';
import { DueIndicator } from '@/components/home/DueIndicator';
import { useColors } from '@/constants/theme';
import { useI18n } from '@/lib/i18n';

interface DeckTreeProps {
  tree: TreeNode[];
  onStudy: (node: TreeNode) => void;
  onEdit: (node: TreeNode) => void;
  onHistory: (node: TreeNode) => void;
  onView: (node: TreeNode) => void;
  tutorialRowRef?: React.RefObject<View | null>;
  tutorialActionsRef?: React.RefObject<View | null>;
}

export function DeckTree({ tree, onStudy, onEdit, onHistory, onView, tutorialRowRef, tutorialActionsRef }: DeckTreeProps) {
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
          onView={onView}
          tutorialRowRef={tutorialRowRef}
          tutorialActionsRef={tutorialActionsRef}
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
  onView: (node: TreeNode) => void;
  tutorialRowRef?: React.RefObject<View | null>;
  tutorialActionsRef?: React.RefObject<View | null>;
}

function TreeRow({ node, depth, collapsedIds, onToggle, onStudy, onEdit, onHistory, onView, tutorialRowRef, tutorialActionsRef }: TreeRowProps) {
  const isCollection = node.deck === null;
  const expanded = !collapsedIds.has(node.id);
  const colors = useColors();
  const { t } = useI18n();

  return (
    <View ref={node.id === '__tutorial__' ? tutorialRowRef : undefined}>
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

        {/* Background preparation status */}
        {!isCollection && (
          <StatusBadge
            explanationStatus={node.deck!.explanationStatus}
            grammarCaseStatus={node.deck!.grammarCaseStatus}
          />
        )}

        <View ref={node.id === '__tutorial__' ? tutorialActionsRef : undefined} style={{ flexDirection: 'row' }}>
          {/* View button — always in the same position for alignment */}
          {!isCollection && node.deck?.explanationStatus === 'ready' && node.deck.grammarCaseStatus === 'ready' ? (
            <TouchableOpacity
              className="w-10 h-10 items-center justify-center"
              onPress={() => onView(node)}
              activeOpacity={0.6}
              accessibilityLabel={t('deck.viewExplanation')}
              // @ts-ignore — title is valid on web View for hover tooltip
              title={t('deck.viewExplanation')}
            >
              <Icon name="book" size={16} color={colors.foreground_secondary} />
            </TouchableOpacity>
          ) : (
            <View style={{ width: 40 }} />
          )}

          {/* History button */}
          <TouchableOpacity
            className="w-10 h-10 items-center justify-center"
            onPress={() => onHistory(node)}
            activeOpacity={0.6}
          >
            <Icon name="clock" size={15} color={colors.foreground_secondary} />
          </TouchableOpacity>

          {/* Edit button */}
          <TouchableOpacity
            className="w-10 h-10 items-center justify-center"
            onPress={() => onEdit(node)}
            activeOpacity={0.6}
          >
            <Icon name="pencil" size={16} color={colors.foreground_secondary} />
          </TouchableOpacity>
        </View>
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
                onView={onView}
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

function StatusBadge({
  explanationStatus,
  grammarCaseStatus,
}: {
  explanationStatus: string;
  grammarCaseStatus?: string;
}) {
  const colors = useColors();
  const { t } = useI18n();
  const status = explanationStatus === 'ready' && grammarCaseStatus && grammarCaseStatus !== 'ready'
    ? grammarCaseStatus
    : explanationStatus;
  const isCaseStatus = explanationStatus === 'ready' && grammarCaseStatus && grammarCaseStatus !== 'ready';

  switch (status) {
    case 'generating':
      return (
        // @ts-ignore — title is valid on web View for hover tooltip
        <View style={{ paddingHorizontal: 6 }} title={isCaseStatus ? t('status.caseExtractionRunning') : t('status.explanationGenerationRunning')}>
          <ActivityIndicator size={10} color={colors.primary} />
        </View>
      );
    case 'pending':
      return (
        // @ts-ignore — title is valid on web View for hover tooltip
        <View style={{ paddingHorizontal: 6, justifyContent: 'center' }} title={isCaseStatus ? t('status.caseExtractionQueued') : t('status.explanationGenerationQueued')}>
          <PendingDot color={colors.primary} />
        </View>
      );
    case 'error':
      return (
        // @ts-ignore — title is valid on web View for hover tooltip
        <View style={{ paddingHorizontal: 6, justifyContent: 'center' }} title={isCaseStatus ? t('status.caseExtractionFailed') : t('status.explanationGenerationFailed')}>
          <Icon name="warning" size={12} color={colors.error} />
        </View>
      );
    default:
      return null;
  }
}
