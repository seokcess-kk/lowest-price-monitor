'use client';

import { useState } from 'react';
import { useProducts } from '@/hooks/useProducts';
import ProductForm from '@/components/ProductForm';
import type { Product, CreateProductInput } from '@/types/database';

export default function ManageProductsPage() {
  const { products, loading, error, refetch } = useProducts(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);

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
    refetch();
  };

  const handleToggle = async (id: string) => {
    const res = await fetch(`/api/products/${id}/toggle`, { method: 'PATCH' });
    if (!res.ok) {
      const body = await res.json();
      alert(body.error || '토글 실패');
      return;
    }
    refetch();
  };

  const truncateUrl = (url: string, maxLen = 40) => {
    if (url.length <= maxLen) return url;
    return url.slice(0, maxLen) + '...';
  };

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">상품 관리</h1>

      {/* 등록/수정 폼 */}
      <div className="bg-white rounded-lg shadow-sm border p-6 mb-6">
        <h2 className="text-lg font-semibold text-gray-800 mb-4">
          {editingProduct ? '상품 수정' : '상품 등록'}
        </h2>
        <ProductForm
          key={editingProduct?.id || 'new'}
          initialData={editingProduct || undefined}
          onSubmit={editingProduct ? handleUpdate : handleCreate}
          onCancel={editingProduct ? () => setEditingProduct(null) : undefined}
        />
      </div>

      {/* 상품 목록 */}
      <div className="bg-white rounded-lg shadow-sm border">
        <h2 className="text-lg font-semibold text-gray-800 px-4 pt-4 pb-2">상품 목록</h2>

        {loading && <div className="text-center py-8 text-gray-500">로딩 중...</div>}
        {error && <div className="text-center py-8 text-red-500">오류: {error}</div>}

        {!loading && !error && (
          <div className="divide-y">
            {products.map((product) => (
              <div key={product.id} className="px-4 py-4 hover:bg-gray-50">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-3">
                    <span className="font-semibold text-gray-900">{product.name}</span>
                    <span
                      className={`inline-block px-2 py-0.5 text-xs rounded-full ${
                        product.is_active
                          ? 'bg-green-100 text-green-700'
                          : 'bg-gray-100 text-gray-500'
                      }`}
                    >
                      {product.is_active ? '활성' : '비활성'}
                    </span>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setEditingProduct(product)}
                      className="px-3 py-1 text-sm bg-gray-100 text-gray-700 rounded hover:bg-gray-200"
                    >
                      수정
                    </button>
                    <button
                      onClick={() => handleToggle(product.id)}
                      className={`px-3 py-1 text-sm rounded ${
                        product.is_active
                          ? 'bg-red-50 text-red-600 hover:bg-red-100'
                          : 'bg-green-50 text-green-600 hover:bg-green-100'
                      }`}
                    >
                      {product.is_active ? '비활성화' : '활성화'}
                    </button>
                  </div>
                </div>
                <div className="flex flex-col gap-1 text-sm">
                  <div className="flex items-center gap-2">
                    <span className="inline-block w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: '#E44232' }} />
                    <span className="text-gray-500 w-10 flex-shrink-0">쿠팡</span>
                    {product.coupang_url ? (
                      <a
                        href={product.coupang_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-gray-700 hover:text-blue-600 hover:underline truncate"
                        title={product.coupang_url}
                      >
                        {truncateUrl(product.coupang_url)}
                      </a>
                    ) : (
                      <span className="text-gray-300">미등록</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="inline-block w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: '#03C75A' }} />
                    <span className="text-gray-500 w-10 flex-shrink-0">네이버</span>
                    {product.naver_url ? (
                      <a
                        href={product.naver_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-gray-700 hover:text-blue-600 hover:underline truncate"
                        title={product.naver_url}
                      >
                        {truncateUrl(product.naver_url)}
                      </a>
                    ) : (
                      <span className="text-gray-300">미등록</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="inline-block w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: '#0068B7' }} />
                    <span className="text-gray-500 w-10 flex-shrink-0">다나와</span>
                    {product.danawa_url ? (
                      <a
                        href={product.danawa_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-gray-700 hover:text-blue-600 hover:underline truncate"
                        title={product.danawa_url}
                      >
                        {truncateUrl(product.danawa_url)}
                      </a>
                    ) : (
                      <span className="text-gray-300">미등록</span>
                    )}
                  </div>
                </div>
              </div>
            ))}
            {products.length === 0 && (
              <div className="px-4 py-8 text-center text-gray-400">
                등록된 상품이 없습니다.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
