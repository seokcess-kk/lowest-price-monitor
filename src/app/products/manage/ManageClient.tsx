'use client';

import { useState, useMemo, useEffect } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import dynamic from 'next/dynamic';
import { useProductList } from '@/hooks/useProductList';
import {
  useUrlState,
  stringCodec,
  stringSetCodec,
  enumCodec,
} from '@/hooks/useUrlState';
import ProductForm from '@/components/ProductForm';
import Modal from '@/components/Modal';
import SearchInput from '@/components/SearchInput';
import BrandFilter, { UNCATEGORIZED_BRAND_ID } from '@/components/BrandFilter';
import ActiveFilterChips from '@/components/ActiveFilterChips';
import { ProductRowSkeleton } from '@/components/Skeleton';
import { useToast } from '@/components/Toast';
import type {
  Product,
  Brand,
  CreateProductInput,
  Channel,
  ProductIdsResponse,
} from '@/types/database';

// xlsx-js-style을 포함한 무거운 모달은 사용자가 "Excel 일괄 등록" 버튼을 눌러
// open=true가 될 때까지 코드 다운로드를 미룬다.
const CsvImportModal = dynamic(() => import('@/components/CsvImportModal'), {
  ssr: false,
});

type StatusFilter = 'all' | 'active' | 'inactive';
type OpsPreset = 'none' | 'noUrl' | 'partialUrl' | 'noBrand';
type SortKey = 'name' | 'created' | 'status';
type SortDir = 'asc' | 'desc';

const STATUS_CODEC = enumCodec<StatusFilter>(['all', 'active', 'inactive'], 'all');
const OPS_CODEC = enumCodec<OpsPreset>(
  ['none', 'noUrl', 'partialUrl', 'noBrand'],
  'none'
);
// 페이지 번호 URL 동기화 — 1이 기본이라 1일 땐 query에서 제거
const PAGE_CODEC = {
  parse: (raw: string | null) => {
    const n = raw ? parseInt(raw, 10) : 1;
    return Number.isFinite(n) && n >= 1 ? n : 1;
  },
  format: (v: number) => (v <= 1 ? null : String(v)),
};

const PAGE_SIZE = 50;

const CHANNEL_COLORS: Record<Channel, string> = {
  coupang: '#E44232',
  naver: '#03C75A',
  danawa: '#0068B7',
};

const CHANNEL_LABELS: Record<Channel, string> = {
  coupang: '쿠팡',
  naver: '네이버',
  danawa: '다나와',
};

const CHANNELS: Channel[] = ['coupang', 'naver', 'danawa'];

export default function ManageProductsPage() {
  const toast = useToast();
  const searchParams = useSearchParams();
  const focusId = searchParams.get('id');

  const [search, setSearchRaw] = useUrlState('q', '', stringCodec);
  const [statusFilter, setStatusFilterRaw] = useUrlState<StatusFilter>(
    'status',
    'all',
    STATUS_CODEC
  );
  const [opsPreset, setOpsPresetRaw] = useUrlState<OpsPreset>('ops', 'none', OPS_CODEC);
  const [brandSelection, setBrandSelectionRaw] = useUrlState(
    'brand',
    new Set<string>(),
    stringSetCodec
  );
  const [page, setPage] = useUrlState('page', 1, PAGE_CODEC);
  const [sortKey, setSortKey] = useState<SortKey>('created');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // 필터가 바뀌면 1페이지로 리셋 — 기존 페이지 번호를 유지하면 빈 페이지가 보인다
  const setSearch = (next: string | ((prev: string) => string)) => {
    setSearchRaw(next);
    setPage(1);
  };
  const setStatusFilter = (next: StatusFilter) => {
    setStatusFilterRaw(next);
    setPage(1);
  };
  const setOpsPreset = (next: OpsPreset) => {
    setOpsPresetRaw(next);
    setPage(1);
  };
  const setBrandSelection = (
    next: Set<string> | ((prev: Set<string>) => Set<string>)
  ) => {
    setBrandSelectionRaw(next);
    setPage(1);
  };

  const brandIdsArr = useMemo(() => [...brandSelection].sort(), [brandSelection]);
  const { items, total, facets, loading, error, refetch } = useProductList({
    page,
    pageSize: PAGE_SIZE,
    q: search,
    status: statusFilter,
    brandIds: brandIdsArr,
    ops: opsPreset,
    sort: sortKey,
    dir: sortDir,
    includeFacets: true,
  });

  // 브랜드 이름 매핑 (필터 칩 라벨·BrandFilter 목록) — 목록이 페이지 단위라 별도 조회
  const [brands, setBrands] = useState<Brand[]>([]);
  useEffect(() => {
    let cancelled = false;
    fetch('/api/brands')
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled && Array.isArray(data)) setBrands(data as Brand[]);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const [formOpen, setFormOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [csvOpen, setCsvOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<{
    ids: string[];
    label: string;
  } | null>(null);
  const [actionMenu, setActionMenu] = useState<string | null>(null);

  // 상품 상세 → '상품 관리' 진입 시 해당 상품만 보여주는 포커스 모드 (단건 조회)
  const [focusedProduct, setFocusedProduct] = useState<Product | null>(null);
  const [focusLoading, setFocusLoading] = useState(false);
  const [focusVersion, setFocusVersion] = useState(0);
  useEffect(() => {
    if (!focusId) {
      setFocusedProduct(null);
      return;
    }
    let cancelled = false;
    setFocusLoading(true);
    fetch(`/api/products/${focusId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!cancelled) setFocusedProduct((data as Product | null) ?? null);
      })
      .catch(() => {
        if (!cancelled) setFocusedProduct(null);
      })
      .finally(() => {
        if (!cancelled) setFocusLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [focusId, focusVersion]);

  // 뮤테이션 후 목록 + (포커스 모드면) 단건도 함께 갱신
  const refetchAll = () => {
    refetch();
    if (focusId) setFocusVersion((v) => v + 1);
  };

  // URL ?id= 로 진입하면 해당 행을 1회 펼친다. effect 대신 렌더 중 보정 패턴 —
  // 이전 focusId를 기억해 focusId가 바뀔 때만 seeding하고, 이후 사용자 토글은 자유.
  const [seededFocusId, setSeededFocusId] = useState<string | null>(null);
  if (focusId && focusId !== seededFocusId) {
    setSeededFocusId(focusId);
    setExpanded((prev) => new Set([...prev, focusId]));
  }

  // 검색/필터/정렬/페이지는 전부 서버에서 처리 — 여기서는 표시할 목록만 결정
  const displayItems = focusId ? (focusedProduct ? [focusedProduct] : []) : items;
  const listLoading = focusId ? focusLoading : loading;

  // 절대값 카운트 (필터와 무관) — products_facets RPC 결과
  const counts = facets?.status ?? { all: total, active: 0, inactive: 0 };
  const opsCounts = facets?.ops ?? { noUrl: 0, partialUrl: 0, noBrand: 0 };
  const brandCounts = {
    byId: facets?.brands ?? {},
    uncategorized: facets?.uncategorized ?? 0,
  };

  // 적용된 필터 요약
  const activeChips = useMemo(() => {
    const items: Array<{
      label: string;
      tone?: 'search' | 'filter' | 'brand';
      onRemove?: () => void;
    }> = [];
    if (search.trim())
      items.push({
        label: `검색: "${search.trim()}"`,
        tone: 'search',
        onRemove: () => setSearch(''),
      });
    if (statusFilter !== 'all')
      items.push({
        label: statusFilter === 'active' ? '활성만' : '비활성만',
        tone: 'filter',
        onRemove: () => setStatusFilter('all'),
      });
    if (opsPreset !== 'none') {
      const opsLabel: Record<Exclude<OpsPreset, 'none'>, string> = {
        noUrl: 'URL 미등록',
        partialUrl: 'URL 일부 누락',
        noBrand: '브랜드 미분류',
      };
      items.push({
        label: opsLabel[opsPreset],
        tone: 'filter',
        onRemove: () => setOpsPreset('none'),
      });
    }
    if (brandSelection.size > 0) {
      const idToName = new Map(brands.map((b) => [b.id, b.name]));
      for (const id of brandSelection) {
        const name = id === UNCATEGORIZED_BRAND_ID ? '미분류' : idToName.get(id) ?? '브랜드';
        items.push({
          label: `브랜드: ${name}`,
          tone: 'brand',
          onRemove: () =>
            setBrandSelection((prev) => {
              const next = new Set(prev);
              next.delete(id);
              return next;
            }),
        });
      }
    }
    return items;
    // setter들은 useUrlState의 안정 참조 + setPage 조합이라 deps 불필요
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, statusFilter, brandSelection, opsPreset, brands]);

  const clearAllFilters = () => {
    setSearch('');
    setStatusFilter('all');
    setOpsPreset('none');
    setBrandSelection(new Set());
  };

  const allVisibleSelected =
    displayItems.length > 0 && displayItems.every((p) => selected.has(p.id));

  // 헤더 체크박스는 "현재 페이지"만 선택/해제 — 선택 Set은 페이지 이동에도 유지된다
  const toggleSelectAll = () => {
    if (allVisibleSelected) {
      setSelected((prev) => {
        const next = new Set(prev);
        displayItems.forEach((p) => next.delete(p.id));
        return next;
      });
    } else {
      setSelected((prev) => {
        const next = new Set(prev);
        displayItems.forEach((p) => next.add(p.id));
        return next;
      });
    }
  };

  // 필터 결과 전체(모든 페이지) 선택 — 서버에서 id만 받아온다
  const [selectingAll, setSelectingAll] = useState(false);
  const selectAllFiltered = async () => {
    setSelectingAll(true);
    try {
      const params = new URLSearchParams();
      if (search.trim()) params.set('q', search.trim());
      if (statusFilter !== 'all') params.set('status', statusFilter);
      if (brandIdsArr.length > 0) params.set('brand_ids', brandIdsArr.join(','));
      if (opsPreset !== 'none') params.set('ops', opsPreset);
      const res = await fetch(`/api/products/ids?${params.toString()}`);
      if (!res.ok) {
        toast.error('필터 결과 전체 선택 실패');
        return;
      }
      const body = (await res.json()) as ProductIdsResponse;
      setSelected(new Set(body.ids));
    } catch {
      toast.error('필터 결과 전체 선택 실패');
    } finally {
      setSelectingAll(false);
    }
  };

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir(key === 'name' ? 'asc' : 'desc');
    }
    setPage(1);
  };

  const toggleExpand = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleCreate = async (data: CreateProductInput) => {
    const res = await fetch('/api/products', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      toast.error(body.error || '등록 실패');
      return;
    }
    const created: Product = await res.json();
    toast.success(`"${data.name}" 등록 완료 — 가격 검증 시작`);
    setFormOpen(false);
    refetchAll();

    // 등록 후 즉시 1회 가격 수집을 트리거해 URL 유효성을 실측 검증.
    // fire-and-forget — 폼은 닫히고 결과는 toast로 전달 (60초 내외 소요).
    fetch(`/api/collect/product/${created.id}`, { method: 'POST' })
      .then(async (r) => {
        const body = await r.json().catch(() => ({}));
        if (!r.ok) {
          toast.error(`"${data.name}" 가격 검증 실패: ${body.error ?? r.statusText}`);
          return;
        }
        const successCount = body.success ?? 0;
        const failedCount = body.failed ?? 0;
        if (successCount > 0 && failedCount === 0) {
          toast.success(`"${data.name}" 가격 검증 완료 — ${successCount}건 성공`);
        } else if (successCount > 0) {
          toast.show(
            `"${data.name}" 가격 검증: ${successCount}건 성공, ${failedCount}건 실패. URL을 확인하세요.`,
            'info'
          );
        } else {
          toast.error(
            `"${data.name}" 모든 채널 검증 실패 (${failedCount}건). URL이 잘못됐을 수 있습니다.`
          );
        }
      })
      .catch((e) => {
        toast.error(
          `"${data.name}" 가격 검증 호출 오류: ${e instanceof Error ? e.message : ''}`
        );
      });
  };

  const handleUpdate = async (data: CreateProductInput) => {
    if (!editingProduct) return;
    const res = await fetch(`/api/products/${editingProduct.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      toast.error(body.error || '수정 실패');
      return;
    }
    toast.success(`"${data.name}" 수정 완료`);
    setEditingProduct(null);
    setFormOpen(false);
    refetchAll();
  };

  const handleToggleActive = async (id: string) => {
    setActionMenu(null);
    const res = await fetch(`/api/products/${id}/toggle`, { method: 'PATCH' });
    if (!res.ok) {
      toast.error('활성 상태 전환 실패');
      return;
    }
    refetchAll();
  };

  const handleDelete = async (ids: string[]) => {
    if (ids.length === 1) {
      const res = await fetch(`/api/products/${ids[0]}`, { method: 'DELETE' });
      if (!res.ok) {
        toast.error('삭제 실패');
        return;
      }
    } else {
      const res = await fetch('/api/products/bulk-action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids, action: 'delete' }),
      });
      if (!res.ok) {
        toast.error('일괄 삭제 실패');
        return;
      }
    }
    toast.success(`${ids.length}개 상품 삭제됨`);
    setConfirmDelete(null);
    setSelected(new Set());
    refetchAll();
  };

  const handleBulkAction = async (action: 'activate' | 'deactivate') => {
    const ids = [...selected];
    if (ids.length === 0) return;
    const res = await fetch('/api/products/bulk-action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids, action }),
    });
    if (!res.ok) {
      toast.error('일괄 작업 실패');
      return;
    }
    toast.success(
      `${ids.length}개 상품 ${action === 'activate' ? '활성화' : '비활성화'}됨`
    );
    setSelected(new Set());
    refetchAll();
  };

  const openEditModal = (product: Product) => {
    setEditingProduct(product);
    setFormOpen(true);
    setActionMenu(null);
  };

  const openCreateModal = () => {
    setEditingProduct(null);
    setFormOpen(true);
  };

  const closeFormModal = () => {
    setFormOpen(false);
    setEditingProduct(null);
  };

  return (
    <div onClick={() => setActionMenu(null)}>
      <div className="flex items-center justify-between mb-4 sm:mb-6 flex-wrap gap-3">
        <h1 className="text-xl sm:text-2xl font-bold text-gray-900">상품 관리</h1>
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <button
            onClick={() => setCsvOpen(true)}
            className="flex-1 sm:flex-none min-h-9 px-3 py-2 text-sm border border-gray-300 rounded-md hover:bg-gray-50 text-gray-700"
          >
            📥 Excel 일괄 등록
          </button>
          <button
            onClick={openCreateModal}
            className="flex-1 sm:flex-none min-h-9 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 text-sm"
          >
            + 새 상품 등록
          </button>
        </div>
      </div>

      {/* 포커스 모드: 상품 상세에서 '상품 관리'로 진입한 단일 상품 컨텍스트 */}
      {focusId && (
        <div className="mb-4 flex items-center justify-between gap-3 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm">
          <span className="text-blue-800 truncate">
            <span className="font-semibold">
              {focusedProduct?.name ?? '선택한 상품'}
            </span>
            <span className="ml-1 text-blue-600">관리 모드</span>
          </span>
          <Link
            href="/products/manage"
            className="shrink-0 px-2.5 py-1 text-xs border border-blue-300 bg-white text-blue-700 rounded hover:bg-blue-100"
          >
            전체 상품 보기
          </Link>
        </div>
      )}

      {/* 검색 + 필터 + 카운트 (포커스 모드에서는 의미 없으므로 숨김) */}
      {!focusId && (
      <div className="bg-white rounded-lg border border-gray-200 p-3 mb-4 flex flex-wrap items-center gap-3">
        <SearchInput value={search} onChange={setSearch} />
        <div className="flex gap-2">
          <FilterChip
            label="전체"
            count={counts.all}
            active={statusFilter === 'all'}
            onClick={() => setStatusFilter('all')}
          />
          <FilterChip
            label="활성"
            count={counts.active}
            active={statusFilter === 'active'}
            onClick={() => setStatusFilter('active')}
          />
          <FilterChip
            label="비활성"
            count={counts.inactive}
            active={statusFilter === 'inactive'}
            onClick={() => setStatusFilter('inactive')}
          />
        </div>
        <BrandFilter
          selected={brandSelection}
          onChange={setBrandSelection}
          counts={brandCounts.byId}
          uncategorizedCount={brandCounts.uncategorized}
        />
        {/* 운영 프리셋 — 정리 작업이 필요한 상품을 한 번에 찾기 위한 빠른 칩 */}
        <div className="flex flex-wrap gap-2 ml-auto">
          <OpsChip
            label="URL 미등록"
            count={opsCounts.noUrl}
            active={opsPreset === 'noUrl'}
            onClick={() => setOpsPreset(opsPreset === 'noUrl' ? 'none' : 'noUrl')}
          />
          <OpsChip
            label="URL 일부 누락"
            count={opsCounts.partialUrl}
            active={opsPreset === 'partialUrl'}
            onClick={() =>
              setOpsPreset(opsPreset === 'partialUrl' ? 'none' : 'partialUrl')
            }
          />
          <OpsChip
            label="브랜드 미분류"
            count={opsCounts.noBrand}
            active={opsPreset === 'noBrand'}
            onClick={() =>
              setOpsPreset(opsPreset === 'noBrand' ? 'none' : 'noBrand')
            }
          />
        </div>
      </div>
      )}

      {!focusId && (
        <ActiveFilterChips
          items={activeChips}
          onClearAll={activeChips.length > 0 ? clearAllFilters : undefined}
          matchedCount={total}
          totalCount={counts.all}
        />
      )}

      {/* 필터 결과가 여러 페이지일 때 전체 선택 진입점 */}
      {!focusId && total > displayItems.length && (
        <div className="mb-3 flex items-center gap-2 text-sm">
          <button
            type="button"
            onClick={selectAllFiltered}
            disabled={selectingAll}
            className="px-2 py-1 text-blue-600 hover:underline disabled:opacity-50"
          >
            {selectingAll
              ? '선택 중...'
              : `필터 결과 ${total.toLocaleString('ko-KR')}개 모두 선택`}
          </button>
          {selected.size > 0 && (
            <span className="text-gray-500">
              (현재 {selected.size.toLocaleString('ko-KR')}개 선택됨)
            </span>
          )}
        </div>
      )}

      {/* 일괄 작업 바 — 데스크톱: 인라인, 모바일: sticky bottom */}
      {selected.size > 0 && (
        <div className="md:mb-4 fixed md:static bottom-0 left-0 right-0 z-20 md:z-auto p-3 bg-blue-50 border-t md:border md:border-blue-200 border-blue-300 md:rounded-lg shadow-lg md:shadow-none flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm text-blue-800 font-medium">
            {selected.size}개 선택됨
          </span>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => handleBulkAction('activate')}
              className="min-h-9 px-3 py-1.5 text-xs bg-green-600 text-white rounded hover:bg-green-700"
            >
              활성화
            </button>
            <button
              onClick={() => handleBulkAction('deactivate')}
              className="min-h-9 px-3 py-1.5 text-xs bg-gray-500 text-white rounded hover:bg-gray-600"
            >
              비활성화
            </button>
            <button
              onClick={() =>
                setConfirmDelete({
                  ids: [...selected],
                  label: `${selected.size}개 상품`,
                })
              }
              className="min-h-9 px-3 py-1.5 text-xs bg-red-600 text-white rounded hover:bg-red-700"
            >
              삭제
            </button>
            <button
              onClick={() => setSelected(new Set())}
              className="min-h-9 px-3 py-1.5 text-xs border border-gray-300 rounded bg-white hover:bg-gray-50 text-gray-700"
            >
              해제
            </button>
          </div>
        </div>
      )}

      {/* 목록 — 모바일 카드 리스트 */}
      <div className="md:hidden mb-20">
        {listLoading && (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <ProductRowSkeleton key={i} />
            ))}
          </div>
        )}
        {error && (
          <div className="text-center py-12 text-red-500">오류: {error}</div>
        )}
        {!listLoading && !error && displayItems.length === 0 && (
          <div className="bg-white rounded-lg border border-gray-200 text-center py-12 text-gray-400">
            {counts.all === 0
              ? '등록된 상품이 없습니다.'
              : '조건에 맞는 상품이 없습니다.'}
          </div>
        )}
        {!listLoading && !error && displayItems.length > 0 && (
          <div className="space-y-2">
            {displayItems.map((product) => {
              const isSelected = selected.has(product.id);
              const isExpanded = expanded.has(product.id);
              return (
                <ProductCardMobile
                  key={product.id}
                  product={product}
                  isSelected={isSelected}
                  isExpanded={isExpanded}
                  onToggleSelect={() => toggleSelect(product.id)}
                  onToggleExpand={() => toggleExpand(product.id)}
                  onEdit={() => openEditModal(product)}
                  onToggleActive={() => handleToggleActive(product.id)}
                  onDelete={() =>
                    setConfirmDelete({
                      ids: [product.id],
                      label: product.name,
                    })
                  }
                />
              );
            })}
          </div>
        )}
      </div>

      {/* 목록 — 데스크톱 테이블 */}
      <div className="hidden md:block bg-white rounded-lg shadow-sm border border-gray-200">
        {listLoading && (
          <div className="p-4 space-y-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <ProductRowSkeleton key={i} />
            ))}
          </div>
        )}
        {error && (
          <div className="text-center py-12 text-red-500">오류: {error}</div>
        )}
        {!listLoading && !error && displayItems.length === 0 && (
          <div className="text-center py-12 text-gray-400">
            {counts.all === 0
              ? '등록된 상품이 없습니다.'
              : '조건에 맞는 상품이 없습니다.'}
          </div>
        )}
        {!listLoading && !error && displayItems.length > 0 && (
          <table className="min-w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="w-10 px-3 py-2 text-center">
                  <input
                    type="checkbox"
                    checked={allVisibleSelected}
                    onChange={toggleSelectAll}
                    aria-label="전체 선택"
                  />
                </th>
                <th className="w-8 px-2 py-2"></th>
                <SortableHeader
                  label="상품명"
                  active={sortKey === 'name'}
                  dir={sortDir}
                  onClick={() => handleSort('name')}
                />
                <th className="px-3 py-2 text-center text-sm font-semibold text-gray-700 w-32">
                  채널
                </th>
                <SortableHeader
                  label="상태"
                  active={sortKey === 'status'}
                  dir={sortDir}
                  onClick={() => handleSort('status')}
                  align="center"
                />
                <SortableHeader
                  label="등록일"
                  active={sortKey === 'created'}
                  dir={sortDir}
                  onClick={() => handleSort('created')}
                  align="center"
                />
                <th className="w-12"></th>
              </tr>
            </thead>
            <tbody>
              {displayItems.map((product) => {
                const isExpanded = expanded.has(product.id);
                const isSelected = selected.has(product.id);
                return (
                  <ProductRow
                    key={product.id}
                    product={product}
                    isExpanded={isExpanded}
                    isSelected={isSelected}
                    onToggleExpand={() => toggleExpand(product.id)}
                    onToggleSelect={() => toggleSelect(product.id)}
                    actionMenuOpen={actionMenu === product.id}
                    onActionMenuToggle={(e) => {
                      e.stopPropagation();
                      setActionMenu(actionMenu === product.id ? null : product.id);
                    }}
                    onEdit={() => openEditModal(product)}
                    onToggleActive={() => handleToggleActive(product.id)}
                    onDelete={() =>
                      setConfirmDelete({
                        ids: [product.id],
                        label: product.name,
                      })
                    }
                  />
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* 페이지네이션 — 서버 페이지 단위 */}
      {!focusId && !listLoading && !error && total > PAGE_SIZE && (
        <div className="mt-4 mb-20 md:mb-4 flex items-center justify-center gap-3 text-sm">
          <button
            type="button"
            onClick={() => setPage(Math.max(1, page - 1))}
            disabled={page <= 1}
            className="min-h-9 px-3 py-1.5 border border-gray-300 rounded bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            ← 이전
          </button>
          <span className="text-gray-600 tabular-nums">
            {page} / {Math.max(1, Math.ceil(total / PAGE_SIZE))} 페이지
            <span className="ml-2 text-gray-400">
              (총 {total.toLocaleString('ko-KR')}개)
            </span>
          </span>
          <button
            type="button"
            onClick={() => setPage(page + 1)}
            disabled={page >= Math.ceil(total / PAGE_SIZE)}
            className="min-h-9 px-3 py-1.5 border border-gray-300 rounded bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            다음 →
          </button>
        </div>
      )}

      {/* 등록/수정 모달 */}
      <Modal
        open={formOpen}
        onClose={closeFormModal}
        title={editingProduct ? '상품 수정' : '상품 등록'}
        size="md"
      >
        <ProductForm
          key={editingProduct?.id || 'new'}
          initialData={editingProduct || undefined}
          onSubmit={editingProduct ? handleUpdate : handleCreate}
          onCancel={closeFormModal}
        />
      </Modal>

      {/* CSV 가져오기 모달 */}
      <CsvImportModal
        open={csvOpen}
        onClose={() => setCsvOpen(false)}
        onImported={refetchAll}
      />

      {/* 삭제 확인 모달 */}
      <Modal
        open={confirmDelete !== null}
        onClose={() => setConfirmDelete(null)}
        title="상품 삭제 확인"
        size="sm"
      >
        <div className="space-y-4">
          <p className="text-sm text-gray-700">
            <strong className="text-red-600">{confirmDelete?.label}</strong>을(를)
            영구 삭제합니다.
          </p>
          <p className="text-xs text-gray-500">
            관련된 가격 이력과 수집 에러 기록도 함께 삭제되며 되돌릴 수 없습니다.
          </p>
          <div className="flex justify-end gap-2 pt-2">
            <button
              onClick={() => setConfirmDelete(null)}
              className="px-3 py-1.5 text-sm border border-gray-300 rounded text-gray-700 hover:bg-gray-50"
            >
              취소
            </button>
            <button
              onClick={() => confirmDelete && handleDelete(confirmDelete.ids)}
              className="px-3 py-1.5 text-sm bg-red-600 text-white rounded hover:bg-red-700"
            >
              영구 삭제
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

interface FilterChipProps {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}

interface OpsChipProps {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}

function OpsChip({ label, count, active, onClick }: OpsChipProps) {
  const disabled = count === 0 && !active;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
        active
          ? 'bg-amber-500 text-white border-amber-500'
          : disabled
            ? 'bg-gray-50 text-gray-300 border-gray-200 cursor-not-allowed'
            : 'bg-white text-amber-700 border-amber-300 hover:bg-amber-50'
      }`}
    >
      {label}
      <span className={`ml-1.5 ${active ? 'text-amber-100' : 'text-gray-500'}`}>
        {count}
      </span>
    </button>
  );
}

function FilterChip({ label, count, active, onClick }: FilterChipProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
        active
          ? 'bg-blue-600 text-white border-blue-600'
          : 'bg-white text-gray-700 border-gray-300 hover:border-blue-400 hover:text-blue-600'
      }`}
    >
      {label}
      <span className={`ml-1.5 ${active ? 'text-blue-100' : 'text-gray-500'}`}>
        {count}
      </span>
    </button>
  );
}

interface SortableHeaderProps {
  label: string;
  active: boolean;
  dir: SortDir;
  onClick: () => void;
  align?: 'left' | 'center' | 'right';
}

function SortableHeader({
  label,
  active,
  dir,
  onClick,
  align = 'left',
}: SortableHeaderProps) {
  const alignClass =
    align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left';
  const ariaSort = active ? (dir === 'asc' ? 'ascending' : 'descending') : 'none';
  return (
    <th
      scope="col"
      aria-sort={ariaSort}
      className={`px-3 py-2 ${alignClass} text-sm font-semibold text-gray-700`}
    >
      <button
        type="button"
        onClick={onClick}
        className="inline-flex items-center gap-1 select-none hover:text-blue-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded"
      >
        {label}
        <span className={`text-xs ${active ? 'text-blue-600' : 'text-gray-300'}`} aria-hidden>
          {active ? (dir === 'asc' ? '▲' : '▼') : '⇅'}
        </span>
      </button>
    </th>
  );
}

interface ProductRowProps {
  product: Product;
  isExpanded: boolean;
  isSelected: boolean;
  onToggleExpand: () => void;
  onToggleSelect: () => void;
  actionMenuOpen: boolean;
  onActionMenuToggle: (e: React.MouseEvent) => void;
  onEdit: () => void;
  onToggleActive: () => void;
  onDelete: () => void;
}

function ProductRow({
  product,
  isExpanded,
  isSelected,
  onToggleExpand,
  onToggleSelect,
  actionMenuOpen,
  onActionMenuToggle,
  onEdit,
  onToggleActive,
  onDelete,
}: ProductRowProps) {
  const channelDots = CHANNELS.map((ch) => {
    const has = !!product[`${ch}_url` as const];
    return (
      <span
        key={ch}
        title={`${CHANNEL_LABELS[ch]}: ${has ? '등록됨' : '미등록'}`}
        className="inline-block w-2.5 h-2.5 rounded-full mr-1"
        style={{
          backgroundColor: has ? CHANNEL_COLORS[ch] : '#e5e7eb',
        }}
      />
    );
  });

  return (
    <>
      <tr
        className={`border-b border-gray-100 hover:bg-blue-50/30 transition-colors ${
          isSelected ? 'bg-blue-50/40' : ''
        }`}
      >
        <td className="px-3 py-2 text-center" onClick={(e) => e.stopPropagation()}>
          <input
            type="checkbox"
            checked={isSelected}
            onChange={onToggleSelect}
            aria-label={`${product.name} 선택`}
          />
        </td>
        <td className="px-2 py-2 text-center">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onToggleExpand();
            }}
            aria-expanded={isExpanded}
            aria-label={isExpanded ? '채널 URL 닫기' : '채널 URL 펼치기'}
            className="text-gray-400 hover:text-blue-600 text-xs focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded"
          >
            {isExpanded ? '▼' : '▶'}
          </button>
        </td>
        <td
          className="px-3 py-2 cursor-pointer"
          onClick={onToggleExpand}
        >
          <div className="flex flex-col">
            <div className="flex items-center gap-1.5 flex-wrap">
              {product.brand_name && (
                <span className="text-[10px] font-semibold text-purple-700 bg-purple-50 border border-purple-200 rounded px-1.5 py-0.5">
                  {product.brand_name}
                </span>
              )}
              <span className="font-medium text-gray-900">{product.name}</span>
            </div>
            {product.sabangnet_code && (
              <span className="text-[11px] text-gray-500 font-mono">
                사방넷 {product.sabangnet_code}
              </span>
            )}
          </div>
        </td>
        <td className="px-3 py-2 text-center" onClick={onToggleExpand}>
          <span className="inline-flex items-center">{channelDots}</span>
        </td>
        <td className="px-3 py-2 text-center" onClick={onToggleExpand}>
          <span
            className={`inline-block px-2 py-0.5 text-xs rounded-full ${
              product.is_active
                ? 'bg-green-100 text-green-700'
                : 'bg-gray-100 text-gray-500'
            }`}
          >
            {product.is_active ? '활성' : '비활성'}
          </span>
        </td>
        <td className="px-3 py-2 text-center text-xs text-gray-500" onClick={onToggleExpand}>
          {new Date(product.created_at).toLocaleDateString('ko-KR')}
        </td>
        <td className="px-2 py-2 relative">
          <button
            type="button"
            onClick={onActionMenuToggle}
            className="px-2 py-1 text-gray-500 hover:bg-gray-100 rounded"
            aria-label="작업 메뉴"
          >
            ⋯
          </button>
          {actionMenuOpen && (
            <div
              className="absolute right-2 top-9 z-10 bg-white border border-gray-200 rounded shadow-md py-1 min-w-[120px]"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                onClick={onEdit}
                className="block w-full text-left px-3 py-1.5 text-sm hover:bg-gray-50 text-gray-700"
              >
                ✏ 수정
              </button>
              <button
                onClick={onToggleActive}
                className="block w-full text-left px-3 py-1.5 text-sm hover:bg-gray-50 text-gray-700"
              >
                {product.is_active ? '🚫 비활성화' : '✅ 활성화'}
              </button>
              <div className="border-t border-gray-100 my-1" />
              <button
                onClick={onDelete}
                className="block w-full text-left px-3 py-1.5 text-sm hover:bg-red-50 text-red-600"
              >
                🗑 삭제
              </button>
            </div>
          )}
        </td>
      </tr>
      {isExpanded && (
        <tr className="bg-gray-50/60 border-b border-gray-100">
          <td colSpan={7} className="px-4 py-3">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
              {CHANNELS.map((ch) => {
                const url = product[`${ch}_url` as const];
                return (
                  <div
                    key={ch}
                    className="flex items-center gap-2 p-2 bg-white border border-gray-200 rounded"
                  >
                    <span
                      className="inline-block w-2 h-2 rounded-full flex-shrink-0"
                      style={{ backgroundColor: CHANNEL_COLORS[ch] }}
                    />
                    <span className="text-gray-500 w-12 flex-shrink-0">
                      {CHANNEL_LABELS[ch]}
                    </span>
                    {url ? (
                      <a
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-600 hover:underline truncate"
                        title={url}
                      >
                        {url}
                      </a>
                    ) : (
                      <span className="text-gray-300">미등록</span>
                    )}
                  </div>
                );
              })}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

interface ProductCardMobileProps {
  product: Product;
  isSelected: boolean;
  isExpanded: boolean;
  onToggleSelect: () => void;
  onToggleExpand: () => void;
  onEdit: () => void;
  onToggleActive: () => void;
  onDelete: () => void;
}

function ProductCardMobile({
  product,
  isSelected,
  isExpanded,
  onToggleSelect,
  onToggleExpand,
  onEdit,
  onToggleActive,
  onDelete,
}: ProductCardMobileProps) {
  return (
    <div
      className={`bg-white border rounded-lg shadow-sm transition-colors ${
        isSelected ? 'border-blue-400 bg-blue-50/40' : 'border-gray-200'
      }`}
    >
      <div className="p-3">
        <div className="flex items-start gap-2">
          <input
            type="checkbox"
            checked={isSelected}
            onChange={onToggleSelect}
            className="mt-1 w-4 h-4"
            aria-label={`${product.name} 선택`}
          />
          <button
            type="button"
            onClick={onToggleExpand}
            className="flex-1 text-left min-w-0"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 flex-wrap flex-1">
                {product.brand_name && (
                  <span className="text-[10px] font-semibold text-purple-700 bg-purple-50 border border-purple-200 rounded px-1.5 py-0.5">
                    {product.brand_name}
                  </span>
                )}
                <span className="font-medium text-gray-900 break-keep">
                  {product.name}
                </span>
              </div>
              <span className="text-gray-400 text-xs shrink-0">
                {isExpanded ? '▼' : '▶'}
              </span>
            </div>
            {product.sabangnet_code && (
              <div className="mt-0.5 text-[11px] text-gray-500 font-mono">
                사방넷 {product.sabangnet_code}
              </div>
            )}
            <div className="mt-1.5 flex items-center gap-2 text-xs text-gray-500">
              <span className="inline-flex items-center gap-1">
                {CHANNELS.map((ch) => {
                  const has = !!product[`${ch}_url` as const];
                  return (
                    <span
                      key={ch}
                      title={`${CHANNEL_LABELS[ch]}: ${has ? '등록됨' : '미등록'}`}
                      className="inline-block w-2 h-2 rounded-full"
                      style={{
                        backgroundColor: has ? CHANNEL_COLORS[ch] : '#e5e7eb',
                      }}
                    />
                  );
                })}
              </span>
              <span
                className={`inline-block px-1.5 py-0.5 text-[11px] rounded-full ${
                  product.is_active
                    ? 'bg-green-100 text-green-700'
                    : 'bg-gray-100 text-gray-500'
                }`}
              >
                {product.is_active ? '활성' : '비활성'}
              </span>
              <span className="text-[11px]">
                {new Date(product.created_at).toLocaleDateString('ko-KR')}
              </span>
            </div>
          </button>
        </div>

        {isExpanded && (
          <div className="mt-3 pt-3 border-t border-gray-100 space-y-2">
            {CHANNELS.map((ch) => {
              const url = product[`${ch}_url` as const];
              return (
                <div
                  key={ch}
                  className="flex items-center gap-2 text-xs"
                >
                  <span
                    className="inline-block w-2 h-2 rounded-full flex-shrink-0"
                    style={{ backgroundColor: CHANNEL_COLORS[ch] }}
                  />
                  <span className="text-gray-500 w-10 shrink-0">
                    {CHANNEL_LABELS[ch]}
                  </span>
                  {url ? (
                    <a
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-600 hover:underline truncate flex-1"
                      title={url}
                    >
                      {url}
                    </a>
                  ) : (
                    <span className="text-gray-300">미등록</span>
                  )}
                </div>
              );
            })}
            <div className="pt-2 flex gap-2">
              <button
                onClick={onEdit}
                className="flex-1 min-h-9 px-3 py-1.5 text-xs border border-gray-300 rounded text-gray-700 hover:bg-gray-50"
              >
                ✏ 수정
              </button>
              <button
                onClick={onToggleActive}
                className="flex-1 min-h-9 px-3 py-1.5 text-xs border border-gray-300 rounded text-gray-700 hover:bg-gray-50"
              >
                {product.is_active ? '🚫 비활성화' : '✅ 활성화'}
              </button>
              <button
                onClick={onDelete}
                className="flex-1 min-h-9 px-3 py-1.5 text-xs bg-red-50 border border-red-200 rounded text-red-600 hover:bg-red-100"
              >
                🗑 삭제
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
