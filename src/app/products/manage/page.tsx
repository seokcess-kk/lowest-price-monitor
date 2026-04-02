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
          <div className="overflow-x-auto">
            <table className="min-w-full border-collapse">
              <thead>
                <tr className="bg-gray-50 border-b">
                  <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">상품명</th>
                  <th className="px-4 py-3 text-center text-sm font-semibold text-gray-700">상태</th>
                  <th className="px-4 py-3 text-center text-sm font-semibold text-gray-700">쿠팡</th>
                  <th className="px-4 py-3 text-center text-sm font-semibold text-gray-700">네이버</th>
                  <th className="px-4 py-3 text-center text-sm font-semibold text-gray-700">다나와</th>
                  <th className="px-4 py-3 text-center text-sm font-semibold text-gray-700">관리</th>
                </tr>
              </thead>
              <tbody>
                {products.map((product) => (
                  <tr key={product.id} className="border-b hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium">{product.name}</td>
                    <td className="px-4 py-3 text-center">
                      <span
                        className={`inline-block px-2 py-1 text-xs rounded-full ${
                          product.is_active
                            ? 'bg-green-100 text-green-700'
                            : 'bg-gray-100 text-gray-500'
                        }`}
                      >
                        {product.is_active ? '활성' : '비활성'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center text-sm">
                      {product.coupang_url ? (
                        <span className="text-green-600">O</span>
                      ) : (
                        <span className="text-gray-300">-</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center text-sm">
                      {product.naver_url ? (
                        <span className="text-green-600">O</span>
                      ) : (
                        <span className="text-gray-300">-</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center text-sm">
                      {product.danawa_url ? (
                        <span className="text-green-600">O</span>
                      ) : (
                        <span className="text-gray-300">-</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <div className="flex justify-center gap-2">
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
                    </td>
                  </tr>
                ))}
                {products.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-gray-400">
                      등록된 상품이 없습니다.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
