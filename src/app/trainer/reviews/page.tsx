'use client';

import { authFetch } from '@/lib/authFetch';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import Link from 'next/link';
import toast from 'react-hot-toast';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import {
  CheckCircle2,
  Circle,
  BookOpen,
  FileText,
  HelpCircle,
  Eye,
} from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { FlipbookViewer } from '@/components/ui/FlipbookViewer';
import { SubmissionFileLink } from '@/components/trainer/SubmissionFileLink';
import { ConfirmDialog } from '@/components/admin/content-upload/ConfirmDialog';
import { countLabel } from '@/lib/i18n/count-label';
import { isQuizPassed } from '@/lib/catalog/progression';
import { viewerSubtitle } from '@/lib/documentTypeLabel';
import {
  hasReviewFeedback,
  FEEDBACK_REQUIRED,
} from '@/lib/trainer/review-feedback';
import {
  MAX_RESTORED_ROWS,
  saveReviewListState,
  readReviewListState,
  clearReviewListState,
} from '@/lib/trainer/review-list-state';
import {
  BULK_REVIEW_MAX,
  COURSE_GLOBAL,
  courseFilterValue,
  REVIEWS_MAX_PAGE_SIZE,
  REVIEWS_PAGE_SIZE,
  type ReviewStatusFilter,
} from '@/lib/trainer/review-paging';

type EnablerReviewItem = {
  id: string;
  enablerId: string;
  enablerTitle: string;
  traineeId: string;
  traineeName: string;
  solutionText?: string | null;
  solutions?: Array<{ scenarioIndex: number; text: string }> | null;
  trainerFeedback?: string | null;
  feedbacks?: Array<{ scenarioIndex: number; feedback: string }> | null;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  submittedAt: string;
  attemptNumber?: number | null;
};
type UseCaseReviewItem = {
  id: string;
  useCaseId: string;
  useCaseTitle: string;
  traineeId: string;
  traineeName: string;
  submissionText?: string | null;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  submittedAt: string;
  attemptNumber?: number | null;
};
type QuizSubmissionItem = {
  id: string;
  traineeId: string;
  traineeName: string;
  quizId: string;
  quizTitle: string;
  quizType?: 'LESSON' | 'GLOBAL';
  score: number | null;
  isReviewed: boolean;
  submittedAt: string;
  attemptNumber?: number | null;
  difficulty?: 'LOW' | 'MEDIUM' | 'HIGH' | null;
  enablerTitle?: string | null;
};
type SolutionDocInfo = { url: string; title: string };

type Tab = 'enablers' | 'usecases' | 'quizzes';
type Kind = 'enabler' | 'usecase' | 'quiz';
type Filters = {
  status: ReviewStatusFilter;
  quizType: 'all' | 'LESSON' | 'GLOBAL';
  search: string;
  /** 'all', 'global' or the id of a course (Fragenkomplex), WMCNL-3001 */
  course: string;
};
type CourseOption = { id: string; title: string };

const TABS: readonly Tab[] = ['enablers', 'usecases', 'quizzes'];
const STATUS_FILTERS: readonly ReviewStatusFilter[] = [
  'pending',
  'all',
  'approved',
  'rejected',
];
const SEARCH_DELAY_MS = 400;

const kindOfTab = (tab: Tab): Kind =>
  tab === 'enablers' ? 'enabler' : tab === 'usecases' ? 'usecase' : 'quiz';

/** The filter named in the address: `status`, or the older `onlyPending` of the dashboard links. */
function filterFromParams(
  status: string | null,
  onlyPending: string | null
): ReviewStatusFilter | null {
  if (status && (STATUS_FILTERS as readonly string[]).includes(status)) {
    return status as ReviewStatusFilter;
  }
  if (onlyPending === 'true') return 'pending';
  if (onlyPending === 'false') return 'all';
  return null;
}

/** The course filter named in the address: 'global', a course id, else 'all'. */
function courseFromParam(value: string | null): string {
  return courseFilterValue(value) ?? 'all';
}

/** The element of the page that scrolls (the layout scrolls inside a box, not the window). */
function scrollParentOf(element: HTMLElement | null): HTMLElement | null {
  let node = element?.parentElement ?? null;
  while (node) {
    const overflowY = window.getComputedStyle(node).overflowY;
    if (overflowY === 'auto' || overflowY === 'scroll') return node;
    node = node.parentElement;
  }
  return null;
}

/** Rows once, in the order of the first appearance (a row that moved between two pages is not doubled). */
function mergeById<T extends { id: string }>(rows: T[]): T[] {
  const seen = new Set<string>();
  return rows.filter(r => {
    if (seen.has(r.id)) return false;
    seen.add(r.id);
    return true;
  });
}

/** Whether a name says something the quiz title does not (WMCNL-3004). */
const sameText = (a?: string | null, b?: string | null) =>
  (a ?? '').trim().toLowerCase() === (b ?? '').trim().toLowerCase();

export default function TrainerReviewsPage() {
  const { profile } = useAuth();
  const { t } = useLanguage();
  const searchParams = useSearchParams();
  const viewParam = searchParams.get('view'); // 'enablers' | 'usecases' | 'quizzes'
  const statusParam = searchParams.get('status'); // pending | all | approved | rejected
  const onlyPendingParam = searchParams.get('onlyPending'); // 'true' | 'false' (links of the dashboard)
  const courseParam = searchParams.get('course'); // 'global' | course id (quiz list)
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The tab and the filter come from the address, so a reload keeps them
  const [activeTab, setActiveTab] = useState<Tab>(
    (TABS as readonly string[]).includes(viewParam ?? '')
      ? (viewParam as Tab)
      : 'enablers'
  );
  // One filter for the page. The quiz list knows only open or all, a status
  // that a quiz does not have counts as "all" there.
  const [statusFilter, setStatusFilter] = useState<ReviewStatusFilter>(
    filterFromParams(statusParam, onlyPendingParam) ?? 'pending'
  );

  // Enabler/UseCase state
  const [enablerSubs, setEnablerSubs] = useState<EnablerReviewItem[]>([]);
  const [useCaseSubs, setUseCaseSubs] = useState<UseCaseReviewItem[]>([]);
  const [enablerTotal, setEnablerTotal] = useState(0);
  const [useCaseTotal, setUseCaseTotal] = useState(0);
  const [feedbackMap, setFeedbackMap] = useState<Record<string, string>>({});
  const [feedbacksMap, setFeedbacksMap] = useState<
    Record<string, Array<{ scenarioIndex: number; feedback: string }>>
  >({});
  const [solutionIndexMap, setSolutionIndexMap] = useState<
    Record<string, number>
  >({});
  // Rejections that were tried without a feedback (WMCNL-3000)
  const [feedbackMissingIds, setFeedbackMissingIds] = useState<Set<string>>(
    new Set()
  );

  // Quiz state
  const [quizzes, setQuizzes] = useState<QuizSubmissionItem[]>([]);
  const [quizTotal, setQuizTotal] = useState(0);
  const [quizTypeFilter, setQuizTypeFilter] = useState<
    'all' | 'LESSON' | 'GLOBAL'
  >('all');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  // The course (Fragenkomplex) of the quiz list, kept in the address
  const [courseFilter, setCourseFilter] = useState<string>(
    courseFromParam(courseParam)
  );
  const [courseOptions, setCourseOptions] = useState<CourseOption[]>([]);
  // Collective action on the quiz list (WMCNL-3001)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkConfirm, setBulkConfirm] = useState<{
    ids: string[];
    trainees: number;
  } | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkResult, setBulkResult] = useState<string | null>(null);

  // Double-click protection: track IDs currently being processed
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  // IDs that are fading out after optimistic update (visual transition before removal)
  const [fadingOutIds, setFadingOutIds] = useState<Set<string>>(new Set());
  // Tracks which already-reviewed items are currently being edited
  const [editingIds, setEditingIds] = useState<Set<string>>(new Set());

  // Solution document state for use cases (TRAINER_SOLUTION PDFs)
  const [solutionDocsMap, setSolutionDocsMap] = useState<
    Record<string, SolutionDocInfo | null>
  >({});
  const [flipbookState, setFlipbookState] = useState<{
    isOpen: boolean;
    url: string;
    title: string;
  }>({ isOpen: false, url: '', title: '' });
  const [loadingActions, setLoadingActions] = useState<
    Record<string, 'APPROVED' | 'REJECTED' | null>
  >({});

  const containerRef = useRef<HTMLDivElement | null>(null);
  // Counts the loads, so the answer of an older load never replaces a newer one
  const loadRun = useRef(0);
  // Scroll position to restore after the list is loaded (back from "Details")
  const pendingScroll = useRef<number | null>(null);

  const quizPending = statusFilter === 'pending';

  const filteredEnablers = useMemo(
    () =>
      enablerSubs.filter(s =>
        statusFilter === 'all' ? true : s.status.toLowerCase() === statusFilter
      ),
    [enablerSubs, statusFilter]
  );
  const filteredUseCases = useMemo(
    () =>
      useCaseSubs.filter(s =>
        statusFilter === 'all' ? true : s.status.toLowerCase() === statusFilter
      ),
    [useCaseSubs, statusFilter]
  );
  const quizzesFiltered = useMemo(
    () => quizzes.filter(q => (quizPending ? !q.isReviewed : true)),
    [quizzes, quizPending]
  );
  // Only an open quiz can be selected for the collective action (WMCNL-3001)
  const selectableQuizzes = useMemo(
    () => quizzesFiltered.filter(q => !q.isReviewed),
    [quizzesFiltered]
  );
  const selectedQuizzes = useMemo(
    () => selectableQuizzes.filter(q => selectedIds.has(q.id)),
    [selectableQuizzes, selectedIds]
  );
  const allSelected =
    selectableQuizzes.length > 0 &&
    selectableQuizzes
      .slice(0, BULK_REVIEW_MAX)
      .every(q => selectedIds.has(q.id));

  // Fetch solution document (TRAINER_SOLUTION) for a use case
  // Use a ref to track which IDs are already fetched/loading to avoid re-triggering
  const fetchedDocIdsRef = useRef<Set<string>>(new Set());
  const fetchSolutionDoc = useCallback(async (useCaseId: string) => {
    if (fetchedDocIdsRef.current.has(useCaseId)) return;
    fetchedDocIdsRef.current.add(useCaseId);
    try {
      const res = await authFetch(
        `/api/trainer/use-cases/${useCaseId}/documents`,
        {
          cache: 'no-store',
        }
      );
      if (!res.ok) {
        setSolutionDocsMap(prev => ({ ...prev, [useCaseId]: null }));
        return;
      }
      const data = await res.json();
      const solutionDoc = (data.documents || []).find(
        (d: any) => d.documentType === 'TRAINER_SOLUTION'
      );
      if (solutionDoc?.storageUrl) {
        setSolutionDocsMap(prev => ({
          ...prev,
          [useCaseId]: {
            url: solutionDoc.storageUrl,
            title: solutionDoc.title || t('trainer.reviews.solutionPdf'),
          },
        }));
      } else {
        setSolutionDocsMap(prev => ({ ...prev, [useCaseId]: null }));
      }
    } catch {
      setSolutionDocsMap(prev => ({ ...prev, [useCaseId]: null }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load solution documents when use case submissions change
  useEffect(() => {
    if (activeTab !== 'usecases' || useCaseSubs.length === 0) return;
    const uniqueIds = Array.from(new Set(useCaseSubs.map(s => s.useCaseId)));
    uniqueIds.forEach(id => fetchSolutionDoc(id));
  }, [useCaseSubs, activeTab, fetchSolutionDoc]);

  const openFlipbook = (url: string, title: string) =>
    setFlipbookState({ isOpen: true, url, title });
  const closeFlipbook = () =>
    setFlipbookState({ isOpen: false, url: '', title: '' });

  // Sync state from URL params (deep-linking from dashboard and notifications)
  useEffect(() => {
    if (viewParam && (TABS as readonly string[]).includes(viewParam)) {
      setActiveTab(viewParam as Tab);
    }
    const fromUrl = filterFromParams(statusParam, onlyPendingParam);
    if (fromUrl) setStatusFilter(fromUrl);
    if (courseParam !== null) setCourseFilter(courseFromParam(courseParam));
  }, [viewParam, statusParam, onlyPendingParam, courseParam]);

  // The tab and the filter stay in the address (WMCNL-3002): a reload, the way
  // back from "Details" and a link keep them. Everything else in the address
  // (the chosen occupation) stays as it is.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    params.set('view', activeTab);
    params.set('status', statusFilter);
    params.delete('onlyPending');
    // the course of the quiz list is part of the address of that list only
    if (activeTab === 'quizzes' && courseFilter !== 'all') {
      params.set('course', courseFilter);
    } else {
      params.delete('course');
    }
    const next = params.toString();
    if (next !== window.location.search.replace(/^\?/, '')) {
      window.history.replaceState(
        window.history.state,
        '',
        `${window.location.pathname}?${next}`
      );
    }
  }, [activeTab, statusFilter, courseFilter]);

  // The search text is sent a moment after the last key
  useEffect(() => {
    const timer = window.setTimeout(
      () => setSearch(searchInput.trim()),
      SEARCH_DELAY_MS
    );
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  const filters: Filters = useMemo(
    () => ({
      status: statusFilter,
      quizType: quizTypeFilter,
      search,
      course: courseFilter,
    }),
    [statusFilter, quizTypeFilter, search, courseFilter]
  );

  // The courses (Fragenkomplexe) of the chosen occupation for the course filter
  // of the quiz list. The list works without them (all and global).
  const coursesLoadedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!profile?.id || activeTab !== 'quizzes') return;
    const catalog = new URLSearchParams(window.location.search).get('catalog');
    const key = catalog ?? '';
    if (coursesLoadedFor.current === key) return;
    coursesLoadedFor.current = key;
    void (async () => {
      try {
        const res = await authFetch('/api/trainer/courses', {
          cache: 'no-store',
        });
        if (!res.ok) {
          coursesLoadedFor.current = null;
          return;
        }
        const data = await res.json();
        const options: CourseOption[] = (data.courses || []).map((c: any) => ({
          id: String(c.id),
          title: String(c.title),
        }));
        setCourseOptions(options);
        // a course in the address that is none of this occupation
        setCourseFilter(current =>
          current === 'all' ||
          current === COURSE_GLOBAL ||
          options.some(o => o.id === current)
            ? current
            : 'all'
        );
      } catch {
        coursesLoadedFor.current = null;
      }
    })();
  }, [profile?.id, activeTab, searchParams]);

  // Another list, another selection
  useEffect(() => {
    setSelectedIds(new Set());
    setBulkResult(null);
  }, [activeTab, filters]);

  // One page of one list, with the total of the same filter
  const fetchPage = useCallback(
    async (
      kind: Kind,
      f: Filters,
      offset: number,
      limit: number
    ): Promise<{ items: any[]; total: number }> => {
      if (kind === 'quiz') {
        const q = new URLSearchParams({
          onlyPending: String(f.status === 'pending'),
          limit: String(limit),
          offset: String(offset),
        });
        if (f.quizType !== 'all') q.set('quizType', f.quizType);
        if (f.search) q.set('q', f.search);
        if (f.course !== 'all') q.set('course', f.course);
        const res = await authFetch(`/api/trainer/quiz-submissions?${q}`, {
          cache: 'no-store',
        });
        if (!res.ok) throw new Error(t('trainer.reviews.quizLoadError'));
        const data = await res.json();
        return {
          items: data.submissions || [],
          total: Number(data.total) || 0,
        };
      }
      const q = new URLSearchParams({
        type: kind,
        status: f.status,
        limit: String(limit),
        offset: String(offset),
      });
      const res = await authFetch(`/api/trainer/reviews?${q}`, {
        cache: 'no-store',
      });
      if (!res.ok) throw new Error(t('trainer.reviews.loadError'));
      const data = await res.json();
      return kind === 'enabler'
        ? {
            items: data.enablerSubmissions || [],
            total: Number(data.enablerTotal) || 0,
          }
        : {
            items: data.useCaseSubmissions || [],
            total: Number(data.useCaseTotal) || 0,
          };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  const prefillFeedback = (rows: any[]) => {
    const newFeedback: Record<string, string> = {};
    const newFeedbacks: Record<string, any[]> = {};
    rows.forEach(s => {
      if (s.trainerFeedback) newFeedback[s.id] = s.trainerFeedback;
      if (s.feedbacks) newFeedbacks[s.id] = s.feedbacks;
    });
    setFeedbackMap(prev => ({ ...newFeedback, ...prev }));
    setFeedbacksMap(prev => ({ ...newFeedbacks, ...prev }));
  };

  const applyRows = (kind: Kind, rows: any[], total: number) => {
    if (kind === 'enabler') {
      setEnablerSubs(rows);
      setEnablerTotal(total);
    } else if (kind === 'usecase') {
      setUseCaseSubs(rows);
      setUseCaseTotal(total);
    } else {
      setQuizzes(rows);
      setQuizTotal(total);
    }
    prefillFeedback(rows);
  };

  // The identity of the list a scroll position belongs to
  const listKey = (tab: Tab, f: Filters) =>
    [
      tab,
      f.status,
      f.quizType,
      f.search,
      // the key of a list without a course filter stays as it was
      ...(f.course === 'all' ? [] : [f.course]),
      new URLSearchParams(
        typeof window === 'undefined' ? '' : window.location.search
      ).get('catalog') ?? '',
    ].join('|');

  // Load the first page of the active list. A position stored when "Details"
  // was opened is restored: that many rows are loaded and the page scrolls back.
  useEffect(() => {
    if (!profile?.id) return;
    const kind = kindOfTab(activeTab);
    const run = ++loadRun.current;
    const restore = readReviewListState(listKey(activeTab, filters));
    const target = Math.min(
      restore?.loaded ?? REVIEWS_PAGE_SIZE,
      MAX_RESTORED_ROWS
    );
    setLoading(true);
    setError(null);
    setMoreError(false);
    void (async () => {
      try {
        const first = await fetchPage(kind, filters, 0, REVIEWS_PAGE_SIZE);
        let rows = first.items;
        let total = first.total;
        // more pages only to get back to a stored position
        while (restore && rows.length < Math.min(target, total)) {
          const next = await fetchPage(
            kind,
            filters,
            rows.length,
            Math.min(REVIEWS_MAX_PAGE_SIZE, target - rows.length)
          );
          if (next.items.length === 0) break;
          rows = mergeById([...rows, ...next.items]);
          total = next.total;
        }
        if (run !== loadRun.current) return;
        applyRows(kind, rows, total);
        if (restore) {
          clearReviewListState();
          pendingScroll.current = restore.scrollTop;
        }
      } catch (e: any) {
        if (run !== loadRun.current) return;
        setError(e?.message || t('trainer.reviews.unknownError'));
      } finally {
        if (run === loadRun.current) setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id, activeTab, filters]);

  // Back from "Details": scroll to where the trainer was
  useEffect(() => {
    if (loading || pendingScroll.current === null) return;
    const top = pendingScroll.current;
    pendingScroll.current = null;
    const scroller = scrollParentOf(containerRef.current);
    if (scroller) scroller.scrollTop = top;
  }, [loading, enablerSubs, useCaseSubs, quizzes]);

  // The next page of the active list
  const loadMore = async () => {
    if (loadingMore) return;
    const kind = kindOfTab(activeTab);
    const run = loadRun.current;
    const offset =
      kind === 'enabler'
        ? enablerSubs.length
        : kind === 'usecase'
          ? useCaseSubs.length
          : quizzes.length;
    setLoadingMore(true);
    setMoreError(false);
    try {
      const page = await fetchPage(kind, filters, offset, REVIEWS_PAGE_SIZE);
      if (run !== loadRun.current) return;
      if (kind === 'enabler') {
        setEnablerSubs(prev => mergeById([...prev, ...page.items]));
        setEnablerTotal(page.total);
      } else if (kind === 'usecase') {
        setUseCaseSubs(prev => mergeById([...prev, ...page.items]));
        setUseCaseTotal(page.total);
      } else {
        setQuizzes(prev => mergeById([...prev, ...page.items]));
        setQuizTotal(page.total);
      }
      prefillFeedback(page.items);
    } catch {
      if (run === loadRun.current) setMoreError(true);
    } finally {
      setLoadingMore(false);
    }
  };

  // Remember where the trainer is before a detail page is opened
  const rememberListState = (loaded: number) => {
    const scroller = scrollParentOf(containerRef.current);
    saveReviewListState({
      search: window.location.search.replace(/^\?/, ''),
      key: listKey(activeTab, filters),
      scrollTop: scroller?.scrollTop ?? 0,
      loaded,
    });
  };

  const clearFeedbackMissing = (id: string) =>
    setFeedbackMissingIds(prev => {
      if (!prev.has(id)) return prev;
      const n = new Set(prev);
      n.delete(id);
      return n;
    });

  const reviewItem = async (
    kind: 'enabler' | 'usecase',
    id: string,
    status: 'APPROVED' | 'REJECTED'
  ) => {
    if (!profile?.id) return;

    const feedback = feedbackMap[id] || '';
    const feedbacks = feedbacksMap[id] || [];
    const sendsFeedbacks = kind === 'enabler' && feedbacks.length > 0;
    const sentFeedbacks = feedbacks.filter(f => f.feedback.trim().length > 0);

    // A rejection tells the trainee what to improve: it needs a feedback
    // (WMCNL-3000). The server asks for it as well.
    if (
      status === 'REJECTED' &&
      !hasReviewFeedback(
        sendsFeedbacks ? undefined : feedback,
        sendsFeedbacks ? sentFeedbacks : undefined
      )
    ) {
      setFeedbackMissingIds(prev => new Set(prev).add(id));
      toast.error(t('trainer.reviews.rejectNeedsFeedback'));
      return;
    }
    clearFeedbackMissing(id);

    setLoadingActions(prev => ({ ...prev, [id]: status }));

    // Save previous state for rollback
    const prevEnablers = enablerSubs;
    const prevUseCases = useCaseSubs;

    // Optimistic: immediately update status + start fade-out
    if (kind === 'enabler') {
      setEnablerSubs(prev =>
        prev.map(s => (s.id === id ? { ...s, status } : s))
      );
    } else {
      setUseCaseSubs(prev =>
        prev.map(s => (s.id === id ? { ...s, status } : s))
      );
    }
    setFadingOutIds(prev => new Set(prev).add(id));

    const rollback = () => {
      setEnablerSubs(prevEnablers);
      setUseCaseSubs(prevUseCases);
    };
    const stopFading = () =>
      setFadingOutIds(prev => {
        const n = new Set(prev);
        n.delete(id);
        return n;
      });

    try {
      const url =
        kind === 'enabler'
          ? `/api/trainer/reviews/enablers/${id}`
          : `/api/trainer/reviews/use-cases/${id}`;
      const body = sendsFeedbacks
        ? { status, feedbacks: sentFeedbacks }
        : { status, trainerFeedback: feedback };
      const r = await authFetch(url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        // Rollback on failure
        rollback();
        stopFading();
        const errData = await r.json().catch(() => ({}));
        if (errData?.code === FEEDBACK_REQUIRED) {
          setFeedbackMissingIds(prev => new Set(prev).add(id));
          toast.error(t('trainer.reviews.rejectNeedsFeedback'));
        } else {
          toast.error(t('trainer.reviews.saveError'));
        }
        return;
      }
      toast.success(
        status === 'APPROVED'
          ? t('trainer.reviews.approved')
          : t('trainer.reviews.rejected')
      );
      // Remove from editing mode on success
      setEditingIds(prev => {
        const n = new Set(prev);
        n.delete(id);
        return n;
      });

      // A row that left the filter (decided in the list of the open ones) is
      // gone from the list and from the total, so the counter and the next
      // page stay right without loading the list again
      if (statusFilter !== 'all' && statusFilter !== status.toLowerCase()) {
        if (kind === 'enabler') {
          setEnablerSubs(prev => prev.filter(s => s.id !== id));
          setEnablerTotal(n => Math.max(0, n - 1));
        } else {
          setUseCaseSubs(prev => prev.filter(s => s.id !== id));
          setUseCaseTotal(n => Math.max(0, n - 1));
        }
      }
      stopFading();
    } catch {
      // Rollback on network error
      rollback();
      stopFading();
      toast.error(t('trainer.reviews.saveError'));
    } finally {
      setLoadingActions(prev => ({ ...prev, [id]: null }));
    }
  };

  const toggleSubmissionReviewed = async (id: string, current: boolean) => {
    if (busyIds.has(id)) return;
    setBusyIds(prev => new Set(prev).add(id));

    // Save previous state for rollback
    const prevQuizzes = quizzes;

    // Optimistic: immediately toggle + fade-out if marking reviewed in pending filter
    setQuizzes(prev =>
      prev.map(q => (q.id === id ? { ...q, isReviewed: !current } : q))
    );
    if (!current && quizPending) {
      setFadingOutIds(prev => new Set(prev).add(id));
    }
    const stopFading = () =>
      setFadingOutIds(prev => {
        const n = new Set(prev);
        n.delete(id);
        return n;
      });

    try {
      const r = await authFetch(`/api/trainer/quiz-submissions/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          is_reviewed: !current,
        }),
      });
      if (!r.ok) {
        // Rollback
        setQuizzes(prevQuizzes);
        stopFading();
        const errData = await r.json().catch(() => ({}));
        toast.error(errData?.error || t('trainer.reviews.saveError'));
        return;
      }
      toast.success(
        !current
          ? t('trainer.reviews.markedReviewed')
          : t('trainer.reviews.unmarkedReviewed')
      );

      // A quiz marked as reviewed leaves the list of the open ones: it is gone
      // from the list and from the total, so the counter and the next page
      // stay right without loading the list again
      if (!current && quizPending) {
        setQuizzes(prev => prev.filter(q => q.id !== id));
        setQuizTotal(n => Math.max(0, n - 1));
      }
      stopFading();
    } catch {
      // Rollback
      setQuizzes(prevQuizzes);
      stopFading();
      toast.error(t('trainer.reviews.saveError'));
    } finally {
      setBusyIds(prev => {
        const n = new Set(prev);
        n.delete(id);
        return n;
      });
    }
  };

  const limitReached = () =>
    toast.error(
      t('trainer.reviews.bulkLimit').replace('{max}', String(BULK_REVIEW_MAX))
    );

  const toggleSelected = (id: string) => {
    if (!selectedIds.has(id) && selectedQuizzes.length >= BULK_REVIEW_MAX) {
      limitReached();
      return;
    }
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // "Select all" takes the open quizzes of the list, up to what one request marks
  const toggleSelectAll = () =>
    setSelectedIds(
      allSelected
        ? new Set()
        : new Set(selectableQuizzes.slice(0, BULK_REVIEW_MAX).map(q => q.id))
    );

  // The dialog first: it says how many quizzes of how many trainees
  const askBulkConfirm = () => {
    if (selectedQuizzes.length === 0) return;
    setBulkConfirm({
      ids: selectedQuizzes.map(q => q.id),
      trainees: new Set(selectedQuizzes.map(q => q.traineeId)).size,
    });
  };

  const runBulk = async () => {
    if (!bulkConfirm || bulkBusy) return;
    setBulkBusy(true);
    try {
      const r = await authFetch('/api/trainer/quiz-submissions/bulk-review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: bulkConfirm.ids }),
      });
      if (!r.ok) {
        toast.error(t('trainer.reviews.bulkError'));
        return;
      }
      const data = await r.json();
      const reviewed = new Set<string>(
        Array.isArray(data.reviewedIds) ? data.reviewedIds.map(String) : []
      );
      // What is reviewed now leaves the list of the open ones (and the total),
      // or shows as reviewed in the list of all. What the server skipped stays.
      if (quizPending) {
        setQuizzes(prev => prev.filter(q => !reviewed.has(q.id)));
        setQuizTotal(n => Math.max(0, n - reviewed.size));
      } else {
        setQuizzes(prev =>
          prev.map(q => (reviewed.has(q.id) ? { ...q, isReviewed: true } : q))
        );
      }
      setSelectedIds(new Set());
      const marked = Number(data.marked) || 0;
      const already = Number(data.alreadyReviewed) || 0;
      const skipped = Number(data.skipped) || 0;
      const parts = [
        marked > 0 && countLabel(t, 'trainer.reviews.bulkMarked', marked),
        already > 0 && countLabel(t, 'trainer.reviews.bulkAlready', already),
        skipped > 0 && countLabel(t, 'trainer.reviews.bulkSkipped', skipped),
      ].filter(Boolean);
      const summary = `${parts.join('. ')}.`;
      setBulkResult(summary);
      // what was not done is never reported as done
      if (skipped > 0) toast.error(summary);
      else toast.success(summary);
    } catch {
      toast.error(t('trainer.reviews.bulkError'));
    } finally {
      setBulkBusy(false);
      setBulkConfirm(null);
    }
  };

  const titleKey = {
    pending: 'trainer.reviews.title',
    all: 'trainer.reviews.titleAll',
    approved: 'trainer.reviews.titleApproved',
    rejected: 'trainer.reviews.titleRejected',
  }[quizPending || activeTab !== 'quizzes' ? statusFilter : 'all'];

  const statusLabel = (status: string) => t(`trainer.reviews.status.${status}`);

  // "50 of 2158 shown" and the button for the next page, under the active list
  const listFooter = (shown: number, total: number): ReactNode => (
    <div className="flex flex-col items-center gap-2 pt-1">
      {shown > 0 && (
        <div
          className="text-muted-foreground text-sm"
          data-testid="reviews-count"
        >
          {t('trainer.reviews.count')
            .replace('{shown}', String(shown))
            .replace('{total}', String(Math.max(total, shown)))}
        </div>
      )}
      {shown < total && (
        <button
          type="button"
          disabled={loadingMore}
          onClick={loadMore}
          className="border-accent/30 hover:bg-accent/10 inline-flex items-center gap-2 rounded-md border px-4 py-2 text-sm font-medium transition-colors disabled:opacity-60"
        >
          {loadingMore && <LoadingSpinner size="sm" />}
          {t('trainer.reviews.loadMore')}
        </button>
      )}
      {moreError && (
        <div role="alert" className="text-sm text-red-500">
          {t('trainer.reviews.loadMoreError')}
        </div>
      )}
    </div>
  );

  return (
    <div ref={containerRef} className="mx-auto max-w-6xl space-y-6 p-6">
      <div className="glass-effect border-accent/30 bg-card/90 rounded-3xl border p-5 shadow-lg">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <h1 className="text-foreground text-xl font-bold">{t(titleKey)}</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            className={`rounded-xl border px-3 py-1.5 text-sm transition-colors ${activeTab === 'enablers' ? 'bg-primary text-primary-foreground' : 'border-accent/30 bg-background/60 hover:bg-background/80'}`}
            onClick={() => setActiveTab('enablers')}
          >
            {t('trainer.reviews.lesson')}
          </button>
          <button
            className={`rounded-xl border px-3 py-1.5 text-sm transition-colors ${activeTab === 'usecases' ? 'bg-primary text-primary-foreground' : 'border-accent/30 bg-background/60 hover:bg-background/80'}`}
            onClick={() => setActiveTab('usecases')}
          >
            {t('trainer.reviews.useCases')}
          </button>
          <button
            className={`rounded-xl border px-3 py-1.5 text-sm transition-colors ${activeTab === 'quizzes' ? 'bg-primary text-primary-foreground' : 'border-accent/30 bg-background/60 hover:bg-background/80'}`}
            onClick={() => setActiveTab('quizzes')}
          >
            {t('trainer.reviews.quizzes')}
          </button>
          <div className="ml-auto flex items-center gap-2 text-sm">
            {activeTab === 'enablers' || activeTab === 'usecases' ? (
              <>
                <span>{t('trainer.reviews.filter')}</span>
                <select
                  data-hai-form="reviews_filter"
                  data-hai-field="status"
                  value={statusFilter}
                  onChange={e => setStatusFilter(e.target.value as any)}
                  className="border-accent/30 bg-background/50 rounded-xl border px-2 py-1"
                >
                  <option value="all">{t('trainer.reviews.all')}</option>
                  <option value="pending">
                    {t('trainer.reviews.pending')}
                  </option>
                  <option value="approved">
                    {t('trainer.reviews.approved')}
                  </option>
                  <option value="rejected">
                    {t('trainer.reviews.rejected')}
                  </option>
                </select>
              </>
            ) : (
              <>
                <span>{t('trainer.reviews.filter')}</span>
                <select
                  value={quizPending ? 'pending' : 'all'}
                  onChange={e =>
                    setStatusFilter(e.target.value as ReviewStatusFilter)
                  }
                  className="border-accent/30 bg-background/50 rounded-xl border px-2 py-1"
                >
                  <option value="pending">
                    {t('trainer.reviews.pending')}
                  </option>
                  <option value="all">{t('trainer.reviews.all')}</option>
                </select>
                {activeTab === 'quizzes' && (
                  <>
                    <span>{t('trainer.reviews.type')}</span>
                    <select
                      value={quizTypeFilter}
                      onChange={e => setQuizTypeFilter(e.target.value as any)}
                      className="border-accent/30 bg-background/50 rounded-xl border px-2 py-1"
                    >
                      <option value="all">{t('trainer.reviews.all')}</option>
                      <option value="LESSON">
                        {t('trainer.reviews.quizType.LESSON')}
                      </option>
                      <option value="GLOBAL">
                        {t('trainer.reviews.quizType.GLOBAL')}
                      </option>
                    </select>
                    <span>{t('trainer.reviews.course')}</span>
                    <select
                      value={courseFilter}
                      onChange={e => setCourseFilter(e.target.value)}
                      aria-label={t('trainer.reviews.course')}
                      className="border-accent/30 bg-background/50 max-w-[16rem] rounded-xl border px-2 py-1"
                    >
                      <option value="all">{t('trainer.reviews.all')}</option>
                      <option value={COURSE_GLOBAL}>
                        {t('trainer.reviews.global')}
                      </option>
                      {courseOptions.map(c => (
                        <option key={c.id} value={c.id}>
                          {c.title}
                        </option>
                      ))}
                    </select>
                    <input
                      type="search"
                      data-hai-form="reviews_search"
                      data-hai-field="query"
                      value={searchInput}
                      onChange={e => setSearchInput(e.target.value)}
                      placeholder={t('trainer.reviews.searchPlaceholder')}
                      aria-label={t('trainer.reviews.searchPlaceholder')}
                      maxLength={100}
                      className="border-accent/30 bg-background/50 w-56 rounded-xl border px-2 py-1"
                    />
                  </>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {loading && (
        <div className="flex items-center justify-center py-4">
          <LoadingSpinner size="md" />
        </div>
      )}
      {error && <div className="text-red-500">{error}</div>}

      {!loading && activeTab === 'enablers' && (
        <div className="space-y-4">
          {filteredEnablers.length === 0 && (
            <div className="text-muted-foreground text-sm">
              {t('trainer.reviews.noSubmissions')}
            </div>
          )}
          {filteredEnablers.map(it => (
            <div
              key={it.id}
              className={`group border-accent/30 bg-card hover:border-accent/50 hover:shadow-accent/5 rounded-3xl border p-5 transition-all duration-200 hover:scale-[1.005] hover:shadow-lg ${fadingOutIds.has(it.id) ? 'pointer-events-none scale-[0.98] opacity-40' : ''}`}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="from-accent to-primary text-foreground flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br">
                    <BookOpen className="h-4 w-4" />
                  </div>
                  <div>
                    <div className="font-semibold">{it.enablerTitle}</div>
                    <div className="text-muted-foreground text-xs">
                      {it.traineeName} •{' '}
                      {new Date(it.submittedAt).toLocaleString()}{' '}
                      {it.attemptNumber
                        ? `• ${t('trainer.reviews.attempt').replace('{number}', String(it.attemptNumber))}`
                        : ''}
                    </div>
                  </div>
                </div>
                <div
                  className={`rounded-full px-2.5 py-1 text-xs ${it.status === 'PENDING' ? 'bg-yellow-500/10 text-yellow-600 dark:text-yellow-400' : 'bg-green-500/10 text-green-600 dark:text-green-400'} ${it.status === 'REJECTED' ? 'bg-red-500/10 text-red-600 dark:text-red-400' : ''}`}
                >
                  {statusLabel(it.status)}
                </div>
              </div>
              {(it.solutions || it.solutionText) && (
                <div className="mt-3">
                  {it.solutions && it.solutions.length > 0 ? (
                    <div className="space-y-3">
                      {/* Counter */}
                      {it.solutions.length > 1 && (
                        <div className="text-center">
                          <span className="text-foreground text-sm font-medium">
                            {t('trainer.reviews.scenario')
                              .replace(
                                '{current}',
                                String((solutionIndexMap[it.id] || 0) + 1)
                              )
                              .replace('{total}', String(it.solutions.length))}
                          </span>
                        </div>
                      )}

                      {/* Solution and Feedback Slider */}
                      <div className="relative overflow-hidden">
                        <div
                          className="flex transition-transform duration-300 ease-in-out"
                          style={{
                            transform: `translateX(-${(solutionIndexMap[it.id] || 0) * 100}%)`,
                          }}
                        >
                          {it.solutions.map((sol, idx) => (
                            <div
                              key={idx}
                              className="w-full flex-shrink-0 space-y-3 px-2"
                            >
                              {/* Solution Box */}
                              <div className="border-accent/20 bg-muted/30 rounded-xl border p-4">
                                <div className="mb-2 text-sm font-medium">
                                  {(it.solutions?.length || 0) > 1
                                    ? t('trainer.reviews.solutionFor').replace(
                                        '{index}',
                                        String(sol.scenarioIndex + 1)
                                      )
                                    : t('enablerPage.summaryLabel') ||
                                      t('trainer.reviews.solution')}
                                </div>
                                <p className="text-foreground/90 text-sm whitespace-pre-line">
                                  {sol.text}
                                </p>
                              </div>

                              {/* Feedback Box for this scenario */}
                              <div>
                                <label className="mb-1 block text-sm font-medium">
                                  {(it.solutions?.length || 0) > 1
                                    ? t('trainer.reviews.feedbackFor').replace(
                                        '{index}',
                                        String(sol.scenarioIndex + 1)
                                      )
                                    : t('trainer.reviews.feedback')}
                                </label>
                                <textarea
                                  className="border-accent/30 bg-muted/50 w-full rounded-xl border px-3 py-2 disabled:opacity-80"
                                  rows={3}
                                  disabled={
                                    it.status !== 'PENDING' &&
                                    !editingIds.has(it.id)
                                  }
                                  value={
                                    feedbacksMap[it.id]?.find(
                                      f => f.scenarioIndex === sol.scenarioIndex
                                    )?.feedback || ''
                                  }
                                  onChange={e => {
                                    const newFeedbacks = [
                                      ...(feedbacksMap[it.id] || []),
                                    ];
                                    const existingIdx = newFeedbacks.findIndex(
                                      f => f.scenarioIndex === sol.scenarioIndex
                                    );
                                    if (existingIdx >= 0) {
                                      newFeedbacks[existingIdx] = {
                                        scenarioIndex: sol.scenarioIndex,
                                        feedback: e.target.value,
                                      };
                                    } else {
                                      newFeedbacks.push({
                                        scenarioIndex: sol.scenarioIndex,
                                        feedback: e.target.value,
                                      });
                                    }
                                    setFeedbacksMap(prev => ({
                                      ...prev,
                                      [it.id]: newFeedbacks,
                                    }));
                                    clearFeedbackMissing(it.id);
                                  }}
                                  placeholder={
                                    (it.solutions?.length || 0) > 1
                                      ? t(
                                          'trainer.reviews.feedbackFor'
                                        ).replace(
                                          '{index}',
                                          String(sol.scenarioIndex + 1)
                                        )
                                      : t('trainer.reviews.feedbackPlaceholder')
                                  }
                                />
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Navigation */}
                      {it.solutions.length > 1 && (
                        <div className="flex items-center justify-between">
                          <button
                            type="button"
                            disabled={(solutionIndexMap[it.id] || 0) === 0}
                            onClick={() =>
                              setSolutionIndexMap(prev => ({
                                ...prev,
                                [it.id]: Math.max(0, (prev[it.id] || 0) - 1),
                              }))
                            }
                            className="border-accent/30 hover:bg-accent/10 cursor-pointer rounded-md border px-3 py-1 text-xs disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {t('trainer.reviews.back')}
                          </button>

                          <div className="flex items-center gap-2">
                            {it.solutions.map((_, idx) => (
                              <button
                                key={idx}
                                type="button"
                                onClick={() =>
                                  setSolutionIndexMap(prev => ({
                                    ...prev,
                                    [it.id]: idx,
                                  }))
                                }
                                className={`h-2 cursor-pointer rounded-full transition-all ${
                                  idx === (solutionIndexMap[it.id] || 0)
                                    ? 'bg-primary w-6'
                                    : 'bg-accent/30 hover:bg-accent/50 w-2'
                                }`}
                                aria-label={`Go to solution ${idx + 1}`}
                              />
                            ))}
                          </div>

                          <button
                            type="button"
                            disabled={
                              (solutionIndexMap[it.id] || 0) ===
                              it.solutions.length - 1
                            }
                            onClick={() =>
                              setSolutionIndexMap(prev => ({
                                ...prev,
                                [it.id]: Math.min(
                                  it.solutions!.length - 1,
                                  (prev[it.id] || 0) + 1
                                ),
                              }))
                            }
                            className="border-accent/30 hover:bg-accent/10 cursor-pointer rounded-md border px-3 py-1 text-xs disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {t('trainer.reviews.next')}
                          </button>
                        </div>
                      )}
                    </div>
                  ) : it.solutionText ? (
                    <>
                      <div className="border-accent/20 bg-muted/30 rounded-xl border p-3">
                        <div className="text-sm font-medium">
                          {t('trainer.reviews.solution')}
                        </div>
                        <p className="text-foreground/90 text-sm whitespace-pre-line">
                          {it.solutionText}
                        </p>
                      </div>
                      <div className="mt-3">
                        <label className="mb-1 block text-sm font-medium">
                          {t('trainer.reviews.feedback')}
                        </label>
                        <textarea
                          data-hai-form="review_feedback"
                          data-hai-field="feedback"
                          className="border-accent/30 bg-muted/50 w-full rounded-xl border px-3 py-2 disabled:opacity-80"
                          rows={3}
                          disabled={
                            it.status !== 'PENDING' && !editingIds.has(it.id)
                          }
                          value={feedbackMap[it.id] || ''}
                          onChange={e => {
                            setFeedbackMap(prev => ({
                              ...prev,
                              [it.id]: e.target.value,
                            }));
                            clearFeedbackMissing(it.id);
                          }}
                        />
                      </div>
                    </>
                  ) : null}
                </div>
              )}
              {/* A submission without any text still needs a place for the
                  feedback, a rejection cannot be sent without one */}
              {!(it.solutions && it.solutions.length > 0) &&
                !it.solutionText && (
                  <div className="mt-3">
                    <label className="mb-1 block text-sm font-medium">
                      {t('trainer.reviews.feedback')}
                    </label>
                    <textarea
                      data-hai-form="review_feedback"
                      data-hai-field="feedback"
                      className="border-accent/30 bg-muted/50 w-full rounded-xl border px-3 py-2 disabled:opacity-80"
                      rows={3}
                      disabled={
                        it.status !== 'PENDING' && !editingIds.has(it.id)
                      }
                      value={feedbackMap[it.id] || ''}
                      placeholder={t('trainer.reviews.feedbackPlaceholder')}
                      onChange={e => {
                        setFeedbackMap(prev => ({
                          ...prev,
                          [it.id]: e.target.value,
                        }));
                        clearFeedbackMissing(it.id);
                      }}
                    />
                  </div>
                )}
              {feedbackMissingIds.has(it.id) && (
                <p role="alert" className="mt-2 text-sm text-red-500">
                  {t('trainer.reviews.rejectNeedsFeedback')}
                </p>
              )}
              <div className="mt-3 flex justify-end gap-2">
                {it.status !== 'PENDING' && !editingIds.has(it.id) ? (
                  <button
                    onClick={() =>
                      setEditingIds(prev => new Set(prev).add(it.id))
                    }
                    className="border-accent/30 hover:bg-accent/10 inline-flex items-center gap-1.5 rounded-md border px-4 py-2 text-sm font-medium transition-colors"
                  >
                    {t('common.edit') || 'Update Feedback'}
                  </button>
                ) : (
                  <>
                    <button
                      disabled={!!loadingActions[it.id]}
                      className="border-accent/30 inline-flex items-center gap-1.5 rounded-md border px-3 py-2 disabled:opacity-60"
                      onClick={() => reviewItem('enabler', it.id, 'REJECTED')}
                    >
                      {loadingActions[it.id] === 'REJECTED' ? (
                        <div className="border-destructive/30 border-t-destructive h-3.5 w-3.5 animate-spin rounded-full border-2" />
                      ) : null}
                      {t('trainer.reviews.reject')}
                    </button>
                    <button
                      disabled={!!loadingActions[it.id]}
                      className="bg-primary text-primary-foreground hover:bg-primary/90 inline-flex items-center gap-1.5 rounded-md px-3 py-2 disabled:opacity-60"
                      onClick={() => reviewItem('enabler', it.id, 'APPROVED')}
                    >
                      {loadingActions[it.id] === 'APPROVED' ? (
                        <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                      ) : null}
                      {t('trainer.reviews.approve')}
                    </button>
                    {it.status !== 'PENDING' && (
                      <button
                        onClick={() =>
                          setEditingIds(prev => {
                            const n = new Set(prev);
                            n.delete(it.id);
                            return n;
                          })
                        }
                        className="text-muted-foreground hover:text-foreground px-3 py-2 text-sm"
                      >
                        {t('common.cancel')}
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>
          ))}
          {listFooter(filteredEnablers.length, enablerTotal)}
        </div>
      )}

      {!loading && activeTab === 'usecases' && (
        <div className="space-y-4">
          {filteredUseCases.length === 0 && (
            <div className="text-muted-foreground text-sm">
              {t('trainer.reviews.noSubmissions')}
            </div>
          )}
          {filteredUseCases.map(it => (
            <div
              key={it.id}
              className={`group border-accent/30 bg-card hover:border-accent/50 hover:shadow-accent/5 rounded-3xl border p-5 transition-all duration-200 hover:scale-[1.005] hover:shadow-lg ${fadingOutIds.has(it.id) ? 'pointer-events-none scale-[0.98] opacity-40' : ''}`}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="from-accent to-primary text-foreground flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br">
                    <FileText className="h-4 w-4" />
                  </div>
                  <div>
                    <div className="font-semibold">{it.useCaseTitle}</div>
                    <div className="text-muted-foreground text-xs">
                      {it.traineeName} •{' '}
                      {new Date(it.submittedAt).toLocaleString()}{' '}
                      {it.attemptNumber
                        ? `• ${t('trainer.reviews.attempt').replace('{number}', String(it.attemptNumber))}`
                        : ''}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {solutionDocsMap[it.useCaseId] && (
                    <button
                      onClick={() =>
                        openFlipbook(
                          solutionDocsMap[it.useCaseId]!.url,
                          solutionDocsMap[it.useCaseId]!.title
                        )
                      }
                      className="inline-flex items-center gap-1.5 rounded-xl border border-blue-500/30 bg-blue-500/10 px-3 py-1.5 text-xs font-medium text-blue-600 transition-colors hover:bg-blue-500/20 dark:text-blue-400"
                      title={t('trainer.reviews.viewSolution')}
                    >
                      <Eye className="h-3.5 w-3.5" />
                      {t('trainer.reviews.solutionPdf')}
                    </button>
                  )}
                  <div
                    className={`rounded-full px-2.5 py-1 text-xs ${it.status === 'PENDING' ? 'bg-yellow-500/10 text-yellow-600 dark:text-yellow-400' : 'bg-green-500/10 text-green-600 dark:text-green-400'} ${it.status === 'REJECTED' ? 'bg-red-500/10 text-red-600 dark:text-red-400' : ''}`}
                  >
                    {statusLabel(it.status)}
                  </div>
                </div>
              </div>
              {it.submissionText && (
                <div className="border-accent/20 bg-muted mt-3 rounded-xl border p-3">
                  <div className="text-sm font-medium">
                    {t('trainer.reviews.solution')}
                  </div>
                  <p className="text-foreground/90 text-sm whitespace-pre-line">
                    {it.submissionText}
                  </p>
                </div>
              )}
              <SubmissionFileLink submissionId={it.id} />
              <div className="mt-3">
                <label className="mb-1 block text-sm font-medium">
                  {t('trainer.reviews.feedback')}
                </label>
                <textarea
                  className="border-accent/30 bg-muted/50 w-full rounded-xl border px-3 py-2 disabled:opacity-80"
                  rows={3}
                  disabled={it.status !== 'PENDING' && !editingIds.has(it.id)}
                  value={feedbackMap[it.id] || ''}
                  aria-invalid={feedbackMissingIds.has(it.id) || undefined}
                  onChange={e => {
                    setFeedbackMap(prev => ({
                      ...prev,
                      [it.id]: e.target.value,
                    }));
                    clearFeedbackMissing(it.id);
                  }}
                />
                {feedbackMissingIds.has(it.id) && (
                  <p role="alert" className="mt-1 text-sm text-red-500">
                    {t('trainer.reviews.rejectNeedsFeedback')}
                  </p>
                )}
              </div>
              <div className="mt-3 flex justify-end gap-2">
                {it.status !== 'PENDING' && !editingIds.has(it.id) ? (
                  <button
                    onClick={() =>
                      setEditingIds(prev => new Set(prev).add(it.id))
                    }
                    className="border-accent/30 hover:bg-accent/10 inline-flex items-center gap-1.5 rounded-md border px-4 py-2 text-sm font-medium transition-colors"
                  >
                    {t('common.edit') || 'Update Feedback'}
                  </button>
                ) : (
                  <>
                    <button
                      disabled={!!loadingActions[it.id]}
                      className="border-accent/30 inline-flex items-center gap-1.5 rounded-md border px-3 py-2 disabled:opacity-60"
                      onClick={() => reviewItem('usecase', it.id, 'REJECTED')}
                    >
                      {loadingActions[it.id] === 'REJECTED' ? (
                        <div className="border-destructive/30 border-t-destructive h-3.5 w-3.5 animate-spin rounded-full border-2" />
                      ) : null}
                      {t('trainer.reviews.reject')}
                    </button>
                    <button
                      disabled={!!loadingActions[it.id]}
                      className="bg-primary text-primary-foreground hover:bg-primary/90 inline-flex items-center gap-1.5 rounded-md px-3 py-2 disabled:opacity-60"
                      onClick={() => reviewItem('usecase', it.id, 'APPROVED')}
                    >
                      {loadingActions[it.id] === 'APPROVED' ? (
                        <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                      ) : null}
                      {t('trainer.reviews.approve')}
                    </button>
                    {it.status !== 'PENDING' && (
                      <button
                        onClick={() =>
                          setEditingIds(prev => {
                            const n = new Set(prev);
                            n.delete(it.id);
                            return n;
                          })
                        }
                        className="text-muted-foreground hover:text-foreground px-3 py-2 text-sm"
                      >
                        {t('common.cancel')}
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>
          ))}
          {listFooter(filteredUseCases.length, useCaseTotal)}
        </div>
      )}

      {!loading && activeTab === 'quizzes' && (
        <div className="space-y-4">
          {selectableQuizzes.length > 0 && (
            <div
              role="group"
              aria-label={t('trainer.reviews.bulkBar')}
              data-testid="bulk-bar"
              className="border-accent/30 bg-card/95 sticky top-0 z-10 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl border px-4 py-3 shadow-md backdrop-blur"
            >
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={allSelected}
                  ref={el => {
                    if (el) {
                      el.indeterminate =
                        selectedQuizzes.length > 0 && !allSelected;
                    }
                  }}
                  onChange={toggleSelectAll}
                  className="h-4 w-4"
                />
                {t('trainer.reviews.bulkSelectAll')}
              </label>
              <span
                aria-live="polite"
                data-testid="bulk-count"
                className="text-muted-foreground text-sm"
              >
                {t('trainer.reviews.bulkSelected').replace(
                  '{count}',
                  String(selectedQuizzes.length)
                )}
              </span>
              <button
                type="button"
                disabled={selectedQuizzes.length === 0 || bulkBusy}
                onClick={askBulkConfirm}
                className="border-accent/30 hover:bg-accent/10 rounded-md border px-3 py-2 text-sm font-medium transition-colors disabled:opacity-50"
              >
                {t('trainer.reviews.bulkMark')}
              </button>
              {selectedQuizzes.length > 0 && (
                <button
                  type="button"
                  onClick={() => setSelectedIds(new Set())}
                  className="text-muted-foreground hover:text-foreground px-2 py-2 text-sm"
                >
                  {t('trainer.reviews.bulkClear')}
                </button>
              )}
              {selectableQuizzes.length > BULK_REVIEW_MAX && (
                <span className="text-muted-foreground text-xs">
                  {t('trainer.reviews.bulkLimitHint').replace(
                    '{max}',
                    String(BULK_REVIEW_MAX)
                  )}
                </span>
              )}
            </div>
          )}
          {bulkResult && (
            <div
              role="status"
              data-testid="bulk-result"
              className="rounded-2xl border border-green-600/40 bg-green-500/10 px-4 py-3 text-sm"
            >
              {bulkResult}
            </div>
          )}
          {quizzesFiltered.length === 0 && (
            <div className="text-muted-foreground text-sm">
              {t('trainer.reviews.noQuizSubmissions')}
            </div>
          )}
          {quizzesFiltered.map(s => (
            <div
              key={s.id}
              className={`group border-accent/30 bg-card hover:border-accent/50 hover:shadow-accent/5 rounded-3xl border p-5 transition-all duration-200 hover:scale-[1.005] hover:shadow-lg ${fadingOutIds.has(s.id) ? 'pointer-events-none scale-[0.98] opacity-40' : ''}`}
            >
              {/* The actions never wrap their text: when the title is long the row
                  wraps and the actions move below it (KFB-1177) */}
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  {!s.isReviewed && (
                    <input
                      type="checkbox"
                      checked={selectedIds.has(s.id)}
                      onChange={() => toggleSelected(s.id)}
                      aria-label={t('trainer.reviews.bulkSelectRow')
                        .replace('{title}', s.quizTitle)
                        .replace('{name}', s.traineeName)}
                      className="h-4 w-4 shrink-0"
                    />
                  )}
                  <div className="from-accent to-primary text-foreground flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br">
                    <HelpCircle className="h-4 w-4" />
                  </div>
                  <div>
                    <div className="font-semibold">{s.quizTitle}</div>
                    <div className="text-muted-foreground text-xs">
                      {s.traineeName} •{' '}
                      {new Date(s.submittedAt).toLocaleString()}{' '}
                      {s.attemptNumber
                        ? `• ${t('trainer.reviews.attempt').replace('{number}', String(s.attemptNumber))}`
                        : ''}
                    </div>
                  </div>
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  <span className="bg-muted text-muted-foreground rounded-full px-2.5 py-1 text-xs">
                    {s.quizType
                      ? t(`trainer.reviews.quizType.${s.quizType}`)
                      : '-'}
                  </span>
                  {s.quizType === 'LESSON' && s.difficulty && (
                    <span
                      className={`rounded-full px-2.5 py-1 text-xs ${s.difficulty === 'LOW' ? 'bg-green-500/20 text-green-600 dark:text-green-400' : s.difficulty === 'MEDIUM' ? 'bg-yellow-500/20 text-yellow-600 dark:text-yellow-400' : 'bg-red-500/20 text-red-600 dark:text-red-400'}`}
                    >
                      {t(`trainer.reviews.difficulty.${s.difficulty}`)}
                    </span>
                  )}
                  <Link
                    href={`/trainer/reviews/quizzes/${s.id}`}
                    onClick={() => rememberListState(quizzes.length)}
                    className="border-accent/30 hover:border-accent/60 hover:bg-accent/10 hover:text-accent rounded-md border px-3 py-2 text-sm whitespace-nowrap transition-all duration-200"
                  >
                    {t('trainer.reviews.details')}
                  </Link>
                  <button
                    disabled={busyIds.has(s.id)}
                    onClick={() => toggleSubmissionReviewed(s.id, s.isReviewed)}
                    className={`rounded-md px-3 py-2 text-sm whitespace-nowrap transition-colors disabled:opacity-50 ${s.isReviewed ? 'border border-green-600/40 text-green-600' : 'border-accent/30 hover:bg-background/60 border'}`}
                  >
                    {s.isReviewed ? (
                      <span className="inline-flex items-center gap-1">
                        <CheckCircle2 className="h-4 w-4" />{' '}
                        {t('trainer.reviews.reviewed')}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1">
                        <Circle className="h-4 w-4 shrink-0" />{' '}
                        {t('trainer.reviews.markAsReviewed')}
                      </span>
                    )}
                  </button>
                </div>
              </div>
              {/* The trainee is named in the header, the quiz title is the title of
                  the card: only what the header does not say is repeated here
                  (WMCNL-3004). The score is coloured by the passing score. */}
              <div className="mt-3 flex flex-wrap gap-x-8 gap-y-3">
                <div>
                  <div className="text-muted-foreground text-xs">
                    {t('trainer.reviews.score')}
                  </div>
                  <div
                    className={`text-sm font-medium ${
                      s.score === null
                        ? ''
                        : isQuizPassed(s.score)
                          ? 'text-green-600 dark:text-green-400'
                          : 'text-red-600 dark:text-red-400'
                    }`}
                  >
                    {s.score === null
                      ? t('quizGrading.trainerNotGraded')
                      : `${s.score}%`}
                  </div>
                </div>
                {s.quizType === 'LESSON' &&
                  s.enablerTitle &&
                  !sameText(s.enablerTitle, s.quizTitle) && (
                    <div>
                      <div className="text-muted-foreground text-xs">
                        {t('trainer.reviews.theme')}
                      </div>
                      <div className="text-sm">{s.enablerTitle}</div>
                    </div>
                  )}
              </div>
              <div className="mt-3">
                <label className="mb-1 block text-sm font-medium">
                  {t('trainer.reviews.feedback')}
                </label>
                <textarea
                  className="border-accent/30 bg-muted/50 w-full rounded-xl border px-3 py-2 disabled:opacity-80"
                  rows={3}
                  disabled={s.isReviewed && !editingIds.has(s.id)}
                  value={feedbackMap[s.id] || ''}
                  onChange={e =>
                    setFeedbackMap(prev => ({
                      ...prev,
                      [s.id]: e.target.value,
                    }))
                  }
                  placeholder={t('trainer.reviews.feedbackPlaceholder')}
                />
                <div className="mt-2 flex justify-end gap-2">
                  {s.isReviewed && !editingIds.has(s.id) ? (
                    <button
                      onClick={() =>
                        setEditingIds(prev => new Set(prev).add(s.id))
                      }
                      className="border-accent/30 hover:bg-accent/10 text-foreground rounded-md border px-4 py-2 text-sm font-medium transition-colors"
                    >
                      {t('common.edit') || 'Update Feedback'}
                    </button>
                  ) : (
                    <>
                      <button
                        disabled={busyIds.has(s.id)}
                        onClick={async () => {
                          if (busyIds.has(s.id)) return;
                          const feedback = feedbackMap[s.id] || '';
                          if (!feedback.trim()) {
                            toast.error(t('trainer.reviews.feedbackEmpty'));
                            return;
                          }
                          setBusyIds(prev => new Set(prev).add(s.id));
                          try {
                            const r = await authFetch(
                              `/api/trainer/quiz-submissions/${s.id}`,
                              {
                                method: 'PATCH',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                  trainer_feedback: feedback,
                                }),
                              }
                            );
                            if (!r.ok) {
                              toast.error(t('trainer.reviews.saveError'));
                              return;
                            }
                            toast.success(t('trainer.reviews.feedbackSaved'));
                            // Remove from editing mode on success
                            setEditingIds(prev => {
                              const n = new Set(prev);
                              n.delete(s.id);
                              return n;
                            });
                          } catch {
                            toast.error(t('trainer.reviews.saveError'));
                          } finally {
                            setBusyIds(prev => {
                              const n = new Set(prev);
                              n.delete(s.id);
                              return n;
                            });
                          }
                        }}
                        className="border-accent/30 hover:bg-background/60 rounded-md border px-3 py-2 text-sm disabled:opacity-50"
                      >
                        {t('trainer.reviews.saveFeedback')}
                      </button>
                      {s.isReviewed && (
                        <button
                          onClick={() =>
                            setEditingIds(prev => {
                              const n = new Set(prev);
                              n.delete(s.id);
                              return n;
                            })
                          }
                          className="text-muted-foreground hover:text-foreground px-3 py-2 text-sm"
                        >
                          {t('common.cancel')}
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>
            </div>
          ))}
          {listFooter(quizzesFiltered.length, quizTotal)}
        </div>
      )}

      {/* Collective action: asks first and names the number of quizzes and
          trainees (WMCNL-3001). Escape and the focus trap come from the dialog. */}
      {bulkConfirm && (
        <ConfirmDialog
          title={t('trainer.reviews.bulkConfirmTitle')}
          confirmLabel={t('trainer.reviews.markAsReviewed')}
          busy={bulkBusy}
          onConfirm={runBulk}
          onCancel={() => {
            if (!bulkBusy) setBulkConfirm(null);
          }}
        >
          <p>
            {t('trainer.reviews.bulkConfirmText')
              .replace(
                '{quizzes}',
                countLabel(
                  t,
                  'trainer.reviews.bulkQuizCount',
                  bulkConfirm.ids.length
                )
              )
              .replace(
                '{trainees}',
                countLabel(
                  t,
                  'trainer.reviews.bulkTraineeCount',
                  bulkConfirm.trainees
                )
              )}
          </p>
          <p className="mt-2">{t('trainer.reviews.bulkConfirmNote')}</p>
        </ConfirmDialog>
      )}

      {/* Solution PDF Flipbook Viewer. Only the model solution of a use case is
          opened here, so the line under the title says that (WMCNL-3005) */}
      <FlipbookViewer
        pdfUrl={flipbookState.url}
        title={flipbookState.title}
        subtitle={viewerSubtitle('TRAINER_SOLUTION', t)}
        isOpen={flipbookState.isOpen}
        onClose={closeFlipbook}
      />
    </div>
  );
}
