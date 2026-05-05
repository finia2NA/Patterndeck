import { useState, useEffect, useMemo } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, Platform } from 'react-native';

import Svg, { Polyline, Circle, Line, Text as SvgText } from 'react-native-svg';
import { PageSheetModal } from '@/components/PageSheetModal';
import { useColors } from '@/constants/theme';
import { getDeckReviews, getCollectionReviews, setDeckDueDate, resetDeckToNeverStudied } from '@/lib/api';
import type { DeckReviewRecord, CollectionReviewRecord } from '@/lib/api';
import type { TreeNode } from '@/lib/types';
import { DatePicker } from '@/components/pickers/DatePicker';
import { NeedsConfirmationButton } from '@/components/NeedsConfirmationButton';
import { formatLocalDateToYmd } from '@/components/pickers/dateUtils';

const clickOrTap = Platform.OS === 'web' ? 'Click' : 'Tap';


interface ReviewHistoryModalProps {
  visible: boolean;
  node: TreeNode | null;
  onClose: () => void;
  onStudyAnyway?: () => void;
  onStartNewDeck?: () => void;
  newDeckLimitReached?: boolean;
  showActions?: boolean;
  onScheduleChanged?: () => void;
}

export function ReviewHistoryModal({
  visible,
  node,
  onClose,
  onStudyAnyway,
  onStartNewDeck,
  newDeckLimitReached = false,
  showActions = false,
  onScheduleChanged,
}: ReviewHistoryModalProps) {
  const colors = useColors();
  const isCollection = node ? node.deck === null : false;
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [deckReviews, setDeckReviews] = useState<DeckReviewRecord[]>([]);
  const [collectionReviews, setCollectionReviews] = useState<CollectionReviewRecord[]>([]);
  const [collectionDecks, setCollectionDecks] = useState<{ id: string; name: string }[]>([]);

  const fetchReviews = (nodeId: string, initial: boolean) => {
    if (initial) { setLoading(true); setDeckReviews([]); setCollectionReviews([]); setCollectionDecks([]); }
    else setRefreshing(true);

    if (isCollection) {
      getCollectionReviews(nodeId).then(result => {
        setCollectionReviews(result.reviews);
        setCollectionDecks(result.decks);
      }).catch(() => { }).finally(() => { setLoading(false); setRefreshing(false); });
    } else {
      getDeckReviews(nodeId).then(result => {
        setDeckReviews(result.reviews);
      }).catch(() => { }).finally(() => { setLoading(false); setRefreshing(false); });
    }
  };

  useEffect(() => {
    if (!visible || !node) return;
    fetchReviews(node.id, true);
  }, [visible, node, isCollection]);

  const reloadReviews = () => { if (node) fetchReviews(node.id, false); };

  const reviews = isCollection ? collectionReviews : deckReviews;
  const studyReviews = useMemo(() => reviews.filter(r => r.eventType === 'review' || r.eventType == null), [reviews]);
  const chronological = useMemo(() => [...studyReviews].reverse(), [studyReviews]);
  const title = node ? (isCollection ? node.name : node.name) : 'Review History';

  return (
    <PageSheetModal
      visible={visible}
      title={title}
      cancelText="Close"
      onCancel={onClose}
    >
      {loading ? (
        <View className="items-center py-16">
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : (
        <>
          {/* Header stats */}
          <HeaderStats
            node={node}
            isCollection={isCollection}
            reviews={studyReviews}
            collectionDecks={collectionDecks}
          />

          {/* Reschedule */}
          {!isCollection && node && (
            <RescheduleSection
              node={node}
              onScheduleChanged={onScheduleChanged}
              onReviewsChanged={reloadReviews}
            />
          )}

          {/* Interval chart */}
          {chronological.length >= 2 && (
            <IntervalChart
              reviews={chronological}
              isCollection={isCollection}
              colors={colors}
            />
          )}

          {/* Review table or empty state */}
          {reviews.length === 0 ? (
            <View className="items-center py-16 px-8">
              <Text className="text-foreground-secondary text-base text-center leading-6">
                No review history yet.
              </Text>
            </View>
          ) : (
            <ReviewTable
              reviews={reviews}
              isCollection={isCollection}
              refreshing={refreshing}
            />
          )}
        </>
      )}

      {/* Action prompt */}
      {showActions && (
        <View className="mt-6">
          {onStudyAnyway && (
            <Text className="text-foreground-secondary text-sm">
              This deck is not due yet.{' '}
              <Text className="text-primary font-semibold" onPress={onStudyAnyway}>{clickOrTap} here to study now</Text>
            </Text>
          )}
          {onStartNewDeck && (
            <Text className="text-foreground-secondary text-sm">
              {isCollection ? 'No decks in this collection are due.' : 'This deck has not been started yet.'}{' '}
              {newDeckLimitReached ? (
                <Text className="text-foreground-muted">Daily limit reached.</Text>
              ) : (
                <Text className="text-primary font-semibold" onPress={onStartNewDeck}>{clickOrTap} here to start a new deck now.</Text>
              )}
            </Text>
          )}
        </View>
      )}
    </PageSheetModal>
  );
}

// ─── Reschedule Section ───────────────────────────────────────────────────────

function RescheduleSection({
  node,
  onScheduleChanged,
  onReviewsChanged,
}: {
  node: TreeNode;
  onScheduleChanged?: () => void;
  onReviewsChanged?: () => void;
}) {
  const colors = useColors();
  const [dueDate, setDueDateState] = useState(
    node.deck?.dueAt ? formatLocalDateToYmd(new Date(node.deck.dueAt)) : ''
  );

  useEffect(() => {
    setDueDateState(node.deck?.dueAt ? formatLocalDateToYmd(new Date(node.deck.dueAt)) : '');
  }, [node]);

  async function handleDateChange(value: string) {
    setDueDateState(value);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return;
    await setDeckDueDate(node.id, value);
    onScheduleChanged?.();
    onReviewsChanged?.();
  }

  async function handleReset() {
    setDueDateState('');
    await resetDeckToNeverStudied(node.id);
    onScheduleChanged?.();
    onReviewsChanged?.();
  }

  return (
    <View className="bg-surface border border-border rounded-2xl p-4 mb-4 gap-2">
      <Text className="text-foreground/80 text-sm font-medium">Review Schedule</Text>
      <DatePicker
        value={dueDate}
        onChange={handleDateChange}
        placeholder="Pick due date"
        popoverPlacement="below"
        popoverTitle="Due Date"
        popoverFooter={
          <NeedsConfirmationButton
            label="Reset to Never Studied"
            confirmLabel="Tap again to reset"
            onConfirm={handleReset}
            destructive
          />
        }
        androidNeutralButton={{
          label: 'Reset',
          textColor: colors.error,
          onPress: handleReset,
        }}
      />
    </View>
  );
}

// ─── Header Stats ─────────────────────────────────────────────────────────────

function HeaderStats({
  node,
  isCollection,
  reviews,
  collectionDecks,
}: {
  node: TreeNode | null;
  isCollection: boolean;
  reviews: (DeckReviewRecord | CollectionReviewRecord)[];
  collectionDecks: { id: string; name: string }[];
}) {
  if (!node) return null;

  const totalReviews = reviews.length;
  const avgStars = totalReviews > 0
    ? (reviews.reduce((sum, r) => sum + r.userStars, 0) / totalReviews).toFixed(1)
    : '-';

  if (isCollection) {
    return (
      <View className="bg-surface border border-border rounded-2xl p-4 mb-4 gap-2">
        <View className="flex-row justify-between">
          <StatItem label="Decks" value={String(collectionDecks.length)} />
          <StatItem label="Reviews" value={String(totalReviews)} />
          <StatItem label="Avg Stars" value={avgStars} />
        </View>
      </View>
    );
  }

  const deck = node.deck;
  const dueLabel = deck?.dueAt
    ? new Date(deck.dueAt).toLocaleDateString()
    : 'Not scheduled';
  const intervalLabel = deck?.intervalDays
    ? `${Math.round(deck.intervalDays)}d`
    : '-';

  return (
    <View className="bg-surface border border-border rounded-2xl p-4 mb-4 gap-2">
      <View className="flex-row justify-between">
        <StatItem label="Due" value={dueLabel} />
        <StatItem label="Interval" value={intervalLabel} />
        <StatItem label="Reviews" value={String(totalReviews)} />
        <StatItem label="Avg Stars" value={avgStars} />
      </View>
    </View>
  );
}

function StatItem({ label, value }: { label: string; value: string }) {
  return (
    <View className="items-center">
      <Text className="text-foreground text-base font-semibold">{value}</Text>
      <Text className="text-foreground-secondary text-xs">{label}</Text>
    </View>
  );
}

// ─── Interval Chart ───────────────────────────────────────────────────────────

function IntervalChart({
  reviews,
  isCollection,
  colors,
}: {
  reviews: (DeckReviewRecord | CollectionReviewRecord)[];
  isCollection: boolean;
  colors: ReturnType<typeof useColors>;
}) {
  const chartWidth = 320;
  const chartHeight = 140;
  const padLeft = 40;
  const padRight = 16;
  const padTop = 12;
  const padBottom = 28;
  const plotW = chartWidth - padLeft - padRight;
  const plotH = chartHeight - padTop - padBottom;

  const { lines, maxInterval, dateLabels } = useMemo(() => {
    if (isCollection) {
      const byDeck = new Map<string, typeof reviews>();
      for (const r of reviews) {
        const key = (r as CollectionReviewRecord).deckName ?? r.deckId;
        if (!byDeck.has(key)) byDeck.set(key, []);
        byDeck.get(key)!.push(r);
      }
      let max = 1;
      type ChartPoint = { x: number; y: number; interval: number };
      const ls: { points: ChartPoint[]; label: string }[] = [];
      const allDates = reviews.map(r => new Date(r.studiedAt).getTime());
      const minDate = Math.min(...allDates);
      const maxDate = Math.max(...allDates);
      const dateRange = maxDate - minDate || 1;

      for (const [name, deckReviews] of byDeck) {
        const sorted = [...deckReviews].sort((a, b) => new Date(a.studiedAt).getTime() - new Date(b.studiedAt).getTime());
        const pts: ChartPoint[] = sorted.map(r => {
          const t = new Date(r.studiedAt).getTime();
          return {
            x: padLeft + ((t - minDate) / dateRange) * plotW,
            y: 0,
            interval: r.intervalApplied,
          };
        });
        for (const p of pts) max = Math.max(max, p.interval);
        ls.push({ points: pts, label: name });
      }
      for (const line of ls) {
        for (const p of line.points) {
          p.y = padTop + plotH - (p.interval / max) * plotH;
        }
      }

      const labels: string[] = [];
      if (reviews.length > 0) {
        labels.push(formatShortDate(new Date(minDate)));
        if (minDate !== maxDate) labels.push(formatShortDate(new Date(maxDate)));
      }

      return { lines: ls, maxInterval: max, dateLabels: labels };
    }

    let max = 1;
    const points = reviews.map((r, i) => {
      max = Math.max(max, r.intervalApplied);
      return { x: padLeft + (i / Math.max(1, reviews.length - 1)) * plotW, y: 0, interval: r.intervalApplied };
    });
    for (const p of points) {
      p.y = padTop + plotH - (p.interval / max) * plotH;
    }

    const labels: string[] = [];
    if (reviews.length > 0) {
      labels.push(formatShortDate(new Date(reviews[0].studiedAt)));
      if (reviews.length > 1) labels.push(formatShortDate(new Date(reviews[reviews.length - 1].studiedAt)));
    }

    return { lines: [{ points, label: '' }], maxInterval: max, dateLabels: labels };
  }, [reviews, isCollection, plotW, plotH]);

  const lineColors = [colors.primary, colors.success, colors.error, '#f59e0b', '#8b5cf6', '#06b6d4'];

  return (
    <View className="bg-surface border border-border rounded-2xl p-4 mb-4">
      <Text className="text-foreground-secondary text-xs font-medium mb-2">Interval Over Time</Text>
      <Svg width={chartWidth} height={chartHeight} viewBox={`0 0 ${chartWidth} ${chartHeight}`}>
        {/* Y-axis labels */}
        <SvgText x={padLeft - 6} y={padTop + 4} textAnchor="end" fontSize={10} fill={colors.foreground_secondary}>
          {Math.round(maxInterval)}d
        </SvgText>
        <SvgText x={padLeft - 6} y={padTop + plotH + 4} textAnchor="end" fontSize={10} fill={colors.foreground_secondary}>
          0
        </SvgText>
        {/* Baseline */}
        <Line x1={padLeft} y1={padTop + plotH} x2={padLeft + plotW} y2={padTop + plotH} stroke={colors.border} strokeWidth={1} />

        {/* Lines */}
        {lines.map((line, li) => {
          if (line.points.length < 2) return null;
          const pointStr = line.points.map(p => `${p.x},${p.y}`).join(' ');
          return (
            <Polyline
              key={li}
              points={pointStr}
              fill="none"
              stroke={lineColors[li % lineColors.length]}
              strokeWidth={2}
            />
          );
        })}

        {/* Dots */}
        {lines.map((line, li) =>
          line.points.map((p, pi) => (
            <Circle
              key={`${li}-${pi}`}
              cx={p.x}
              cy={p.y}
              r={3}
              fill={lineColors[li % lineColors.length]}
            />
          ))
        )}

        {/* X-axis date labels */}
        {dateLabels[0] && (
          <SvgText x={padLeft} y={chartHeight - 4} fontSize={10} fill={colors.foreground_secondary}>
            {dateLabels[0]}
          </SvgText>
        )}
        {dateLabels[1] && (
          <SvgText x={padLeft + plotW} y={chartHeight - 4} textAnchor="end" fontSize={10} fill={colors.foreground_secondary}>
            {dateLabels[1]}
          </SvgText>
        )}
      </Svg>

      {/* Legend for collection */}
      {isCollection && lines.length > 1 && (
        <View className="flex-row flex-wrap gap-3 mt-2">
          {lines.map((line, i) => (
            <View key={i} className="flex-row items-center gap-1">
              <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: lineColors[i % lineColors.length] }} />
              <Text className="text-foreground-secondary text-xs" numberOfLines={1}>{line.label}</Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

// ─── Review Table ─────────────────────────────────────────────────────────────

const PAGE_SIZE = 10;

function pageItems(current: number, total: number): (number | '...')[] {
  const pages = new Set([1, Math.max(1, current - 1), current, Math.min(total, current + 1), total]);
  const sorted = Array.from(pages).sort((a, b) => a - b);
  const result: (number | '...')[] = [];
  for (let i = 0; i < sorted.length; i++) {
    if (i > 0 && sorted[i] - sorted[i - 1] > 1) result.push('...');
    result.push(sorted[i]);
  }
  return result;
}

function ReviewTable({
  reviews,
  isCollection,
  refreshing = false,
}: {
  reviews: (DeckReviewRecord | CollectionReviewRecord)[];
  isCollection: boolean;
  refreshing?: boolean;
}) {
  const colors = useColors();
  const [page, setPage] = useState(0);
  const totalPages = Math.ceil(reviews.length / PAGE_SIZE);
  const visible = reviews.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  return (
    <View className="gap-2">
      <View className="bg-surface border border-border rounded-2xl overflow-hidden">
        {/* Table header */}
        <View className="flex-row px-4 py-2 border-b border-border bg-background-muted">
          <Text className="text-foreground-secondary text-xs font-medium" style={{ width: 70 }}>Date</Text>
          {isCollection && <Text className="text-foreground-secondary text-xs font-medium flex-1" numberOfLines={1}>Deck</Text>}
          <Text className="text-foreground-secondary text-xs font-medium text-center" style={{ width: 40 }}>Stars</Text>
          <Text className="text-foreground-secondary text-xs font-medium text-center" style={{ width: 55 }}>Score</Text>
          <Text className="text-foreground-secondary text-xs font-medium text-right" style={{ width: 55 }}>Interval</Text>
        </View>

        {refreshing && page === 0 && (
          <View className="flex-row items-center px-4 py-2.5 border-b border-foreground/5 gap-2">
            <ActivityIndicator size="small" color={colors.primary} />
            <Text className="text-foreground-secondary text-xs italic">Updating…</Text>
          </View>
        )}
        {visible.map((review, i) => {
          const isScheduleChange = review.eventType === 'schedule_change';
          return (
            <View
              key={review.id}
              className={`flex-row items-center px-4 py-2.5 ${i < visible.length - 1 ? 'border-b border-foreground/5' : ''}`}
            >
              <Text className="text-foreground text-xs" style={{ width: 70 }}>
                {formatShortDate(new Date(review.studiedAt))}
              </Text>
              {isCollection && (
                <Text className="text-foreground text-xs flex-1" numberOfLines={1}>
                  {(review as CollectionReviewRecord).deckName}
                </Text>
              )}
              {isScheduleChange ? (
                <Text className="text-foreground-secondary text-xs flex-1 italic" numberOfLines={1}>
                  rescheduled → {review.aiRecap}
                </Text>
              ) : review.eventType === 'reset' ? (
                <Text className="text-foreground-secondary text-xs flex-1 italic" numberOfLines={1}>
                  reset to never studied
                </Text>
              ) : (
                <>
                  <Text className="text-foreground text-xs text-center" style={{ width: 40 }}>
                    {renderStars(review.userStars)}
                  </Text>
                  <Text className="text-foreground text-xs text-center" style={{ width: 55 }}>
                    {review.correctCount != null && review.totalCount != null
                      ? `${review.correctCount}/${review.totalCount}`
                      : '-'}
                  </Text>
                  <Text className="text-foreground-secondary text-xs text-right" style={{ width: 55 }}>
                    {Math.round(review.intervalApplied * 10) / 10}d
                  </Text>
                </>
              )}
            </View>
          );
        })}
      </View>

      {totalPages > 1 && (
        <View className="flex-row items-center justify-center gap-1.5 flex-wrap">
          <PagePill label="first" selected={page === 0} onPress={() => setPage(0)} colors={colors} />
          {pageItems(page + 1, totalPages).map((item, i) =>
            item === '...'
              ? <Text key={`ellipsis-${i}`} className="text-foreground-secondary text-xs px-0.5">…</Text>
              : <PageNumber key={item} n={item} selected={item === page + 1} onPress={() => setPage(item - 1)} colors={colors} />
          )}
          <PagePill label="last" selected={page === totalPages - 1} onPress={() => setPage(totalPages - 1)} colors={colors} />
        </View>
      )}
    </View>
  );
}

function PageNumber({ n, selected, onPress, colors }: { n: number; selected: boolean; onPress: () => void; colors: ReturnType<typeof useColors> }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.7}
      style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: selected ? colors.primary : colors.surface, alignItems: 'center', justifyContent: 'center' }}
    >
      <Text style={{ fontSize: 11, fontWeight: '500', color: selected ? '#fff' : colors.foreground_secondary }}>{n}</Text>
    </TouchableOpacity>
  );
}

function PagePill({ label, selected, onPress, colors }: { label: string; selected: boolean; onPress: () => void; colors: ReturnType<typeof useColors> }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.7}
      style={{ height: 30, paddingHorizontal: 12, borderRadius: 15, backgroundColor: selected ? colors.primary : colors.surface, alignItems: 'center', justifyContent: 'center' }}
    >
      <Text style={{ fontSize: 11, fontWeight: '500', color: selected ? '#fff' : colors.foreground_secondary }}>{label}</Text>
    </TouchableOpacity>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatShortDate(date: Date): string {
  const m = date.getMonth() + 1;
  const d = date.getDate();
  return `${m}/${d}`;
}

function renderStars(count: number): string {
  return '★'.repeat(Math.max(0, Math.min(5, count)));
}
