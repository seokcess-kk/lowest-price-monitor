'use client';

import { useState, useMemo } from 'react';
import { useProducts } from '@/hooks/useProducts';
import ProductForm from '@/components/ProductForm';
import Modal from '@/components/Modal';
import SearchInput from '@/components/SearchInput';
import CsvImportModal from '@/components/CsvImportModal';
import type { Product, CreateProductInput, Channel } from '@/types/database';

type StatusFilter = 'all' | 'active' | 'inactive';
type SortKey = 'name' | 'created' | 'status';
type SortDir = 'asc' | 'desc';

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
  const { products, loading, error, refetch } = useProducts(false);

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [sortKey, setSortKey] = useState<SortKey>('created');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const [formOpen, setFormOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [csvOpen, setCsvOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<{
    ids: string[];
    label: string;
  } | null>(null);
  const [actionMenu, setActionMenu] = useState<string | null>(null);

  // 검색 + 필터 + 정렬
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = products.filter((p) => {
      if (q && !p.name.toLowerCase().includes(q)) return false;
      if (statusFilter === 'active' && !p.is_active) return false;
      if (statusFilter === 'inactive' && p.is_active) return false;
      return true;
    });
    list.sort((a, b) => {
      let cmp = 0;
      if (sortKey === 'name') cmp = a.name.localeCompare(b.name);
      else if (sortKey === 'created')
        cmp = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      else if (sortKey === 'status')
        cmp = Number(a.is_active) - Number(b.is_active);
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return list;
  }, [products, search, statusFilter, sortKey, sortDir]);

  const counts = useMemo(
    () => ({
      all: products.length,
      active: products.filter((p) => p.is_active).length,
      inactive: products.filter((p) => !p.is_active).length,
    }),
    [products]
  );

  const allVisibleSelected =
    filtered.length > 0 && filtered.every((p) => selected.has(p.id));

  const toggleSelectAll = () => {
    if (allVisibleSelected) {
      setSelected((prev) => {
        const next = new Set(prev);
        filtered.forEach((p) => next.delete(p.id));
        return next;
      });
    } else {
      setSelected((prev) => {
        const next = new Set(prev);
        filtered.forEach((p) => next.add(p.id));
        return next;
      });
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
      const body = await res.json();
      alert(body.error || '등록 실패');
      return;
    }
    setFormOpen(false);
    refetch();
  };

  const handleUpdate = async (data: CreateProductInput) => {
    if (!editingProduct) return;
    const res = await fetch(`/api/products/${editingProduct.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const body = await res.json();
      alert(body.error || '수정 실패');
      return;
    }
    setEditingProduct(null);
    setFormOpen(false);
    refetch();
  };

  const handleToggleActive = async (id: string) => {
    setActionMenu(null);
    const res = await fetch(`/api/products/${id}/toggle`, { method: 'PATCH' });
    if (!res.ok) {
      alert('토글 실패');
      return;
    }
    refetch();
  };

  const handleDelete = async (ids: string[]) => {
    if (ids.length === 1) {
      const res = await fetch(`/api/products/${ids[0]}`, { method: 'DELETE' });
      if (!res.ok) {
        alert('삭제 실패');
        return;
      }
    } else {
      const res = await fetch('/api/products/bulk-action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids, action: 'delete' }),
      });
      if (!res.ok) {
        alert('일괄 삭제 실패');
        return;
      }
    }
    setConfirmDelete(null);
    setSelected(new Set());
    refetch();
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
      alert('일괄 작업 실패');
      return;
    }
    setSelected(new Set());
    refetch();
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
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <h1 className="text-2xl font-bold text-gray-900">상품 관리</h1>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setCsvOpen(true)}
            className="px-3 py-2 text-sm border border-gray-300 rounded-md hover:bg-gray-50 text-gray-700"
          >
            📥 Excel 일괄 등록
          </button>
          <button
            onClick={openCreateModal}
            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 text-sm"
          >
            + 새 상품 등록
          </button>
        </div>
      </div>

      {/* 검색 + 필터 + 카운트 */}
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
      </div>

      {/* 일괄 작업 바 */}
      {selected.size > 0 && (
        <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg flex items-center justify-between">
          <span className="text-sm text-blue-800 font-medium">
            {selected.size}개 선택됨
          </span>
          <div className="flex gap-2">
            <button
              onClick={() => handleBulkAction('activate')}
              className="px-3 py-1.5 text-xs bg-green-600 text-white rounded hover:bg-green-700"
            >
              일괄 활성화
            </button>
            <button
              onClick={() => handleBulkAction('deactivate')}
              className="px-3 py-1.5 text-xs bg-gray-500 text-white rounded hover:bg-gray-600"
            >
              일괄 비활성화
            </button>
            <button
              onClick={() =>
                setConfirmDelete({
                  ids: [...selected],
                  label: `${selected.size}개 상품`,
                })
              }
              className="px-3 py-1.5 text-xs bg-red-600 text-white rounded hover:bg-red-700"
            >
              일괄 삭제
            </button>
            <button
              onClick={() => setSelected(new Set())}
              className="px-3 py-1.5 text-xs border border-gray-300 rounded hover:bg-white text-gray-700"
            >
              선택 해제
            </button>
          </div>
        </div>
      )}

      {/* 목록 */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200">
        {loading && (
          <div className="text-center py-12 text-gray-500">로딩 중...</div>
        )}
        {error && (
          <div className="text-center py-12 text-red-500">오류: {error}</div>
        )}
        {!loading && !error && filtered.length === 0 && (
          <div className="text-center py-12 text-gray-400">
            {products.length === 0
              ? '등록된 상품이 없습니다.'
              : '조건에 맞는 상품이 없습니다.'}
          </div>
        )}
        {!loading && !error && filtered.length > 0 && (
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
              {filtered.map((product) => {
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
        onImported={refetch}
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
  return (
    <th
      className={`px-3 py-2 ${alignClass} text-sm font-semibold text-gray-700 cursor-pointer select-none hover:bg-gray-100`}
      onClick={onClick}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        <span className={`text-xs ${active ? 'text-blue-600' : 'text-gray-300'}`}>
          {active ? (dir === 'asc' ? '▲' : '▼') : '⇅'}
        </span>
      </span>
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
        <td
          className="px-2 py-2 text-center text-gray-400 text-xs cursor-pointer"
          onClick={onToggleExpand}
        >
          {isExpanded ? '▼' : '▶'}
        </td>
        <td
          className="px-3 py-2 cursor-pointer"
          onClick={onToggleExpand}
        >
          <span className="font-medium text-gray-900">{product.name}</span>
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
