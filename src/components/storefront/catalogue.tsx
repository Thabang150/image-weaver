import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, Leaf, Search, ShieldCheck, SlidersHorizontal, Truck, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { CartAddButton } from "@/components/storefront/cart";
import { ApiHttpError, ApiResponseError } from "@/lib/api/client";
import { catalogueApi, type PublicProduct } from "@/lib/api/catalogue";
import { getAllowedProductImageUrls } from "@/lib/image-url";
import { formatZarCents } from "@/lib/money";

function getPrimaryImageUrl(product: PublicProduct): string | undefined {
  return getAllowedProductImageUrls(product.imageReferences)[0];
}

function getProductGallery(product: PublicProduct): string[] {
  return getAllowedProductImageUrls(product.imageReferences);
}

function ProductImage({
  product,
  altText,
  className,
}: {
  product: PublicProduct;
  altText: string;
  className?: string;
}) {
  const [hasError, setHasError] = useState(false);
  const imageUrl = getPrimaryImageUrl(product);

  if (!imageUrl || hasError) {
    return (
      <div
        className={className ?? "product-image-placeholder"}
        role="img"
        aria-label={`${altText} image unavailable`}
      >
        <span>Image unavailable</span>
      </div>
    );
  }

  return (
    <img
      src={imageUrl}
      alt={altText}
      className={className ?? "product-image"}
      loading="lazy"
      onError={() => setHasError(true)}
    />
  );
}

function ProductGalleryImage({
  productName,
  imageUrl,
  index,
}: {
  productName: string;
  imageUrl: string;
  index: number;
}) {
  const [hasError, setHasError] = useState(false);

  if (hasError) {
    return (
      <div
        className="product-image-placeholder product-detail-image"
        role="img"
        aria-label={`${productName} image ${index + 1} unavailable`}
      >
        <span>Image unavailable</span>
      </div>
    );
  }

  return (
    <img
      src={imageUrl}
      alt={`${productName} image ${index + 1}`}
      className="product-detail-image"
      loading="lazy"
      onError={() => setHasError(true)}
    />
  );
}

interface CatalogueProps {
  selectedSlug?: string | undefined;
  onSelectProduct: (slug: string) => void;
  onBackToCatalogue: () => void;
}

type ProductSortField = "createdAt" | "name" | "priceCents";
type ProductSortOrder = "asc" | "desc";

function isProductSortField(value: string): value is ProductSortField {
  return value === "createdAt" || value === "name" || value === "priceCents";
}

function isProductSortOrder(value: string): value is ProductSortOrder {
  return value === "asc" || value === "desc";
}

function getErrorMessage(error: Error): string {
  if (error instanceof ApiHttpError) {
    const body = error.body;
    if (
      typeof body === "object" &&
      body !== null &&
      !Array.isArray(body) &&
      "error" in body &&
      typeof body.error === "string" &&
      body.error.trim()
    ) {
      return `The catalogue is unavailable: ${body.error}`;
    }
    return `The catalogue is unavailable (HTTP ${error.status}).`;
  }
  if (error instanceof ApiResponseError) {
    return error.message;
  }
  return "The catalogue could not be reached. Check your connection and try again.";
}

export function Catalogue({ selectedSlug, onSelectProduct, onBackToCatalogue }: CatalogueProps) {
  const [categoryId, setCategoryId] = useState<string>();
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState<{
    q: string;
    minPrice: string;
    maxPrice: string;
    sortBy: ProductSortField;
    sortOrder: ProductSortOrder;
  }>({
    q: "",
    minPrice: "",
    maxPrice: "",
    sortBy: "name",
    sortOrder: "asc",
  });

  return (
    <section id="catalogue" className="catalogue-section" aria-labelledby="catalogue-title">
      {selectedSlug ? (
        <ProductDetail slug={selectedSlug} onBackToCatalogue={onBackToCatalogue} />
      ) : (
        <ProductListing
          categoryId={categoryId}
          page={page}
          filters={filters}
          onCategoryChange={(nextCategoryId) => {
            setCategoryId(nextCategoryId);
            setPage(1);
          }}
          onFiltersChange={(nextFilters) => {
            setFilters(nextFilters);
            setPage(1);
          }}
          onPageChange={setPage}
          onSelectProduct={onSelectProduct}
        />
      )}
    </section>
  );
}

interface ProductListingProps {
  categoryId: string | undefined;
  page: number;
  filters: {
    q: string;
    minPrice: string;
    maxPrice: string;
    sortBy: ProductSortField;
    sortOrder: ProductSortOrder;
  };
  onCategoryChange: (categoryId: string | undefined) => void;
  onFiltersChange: (filters: ProductListingProps["filters"]) => void;
  onPageChange: (page: number | ((previousPage: number) => number)) => void;
  onSelectProduct: CatalogueProps["onSelectProduct"];
}

function hasActiveFilters(categoryId: string | undefined, filters: ProductListingProps["filters"]) {
  return Boolean(categoryId || filters.q || filters.minPrice || filters.maxPrice);
}

function ProductCardSkeleton() {
  return (
    <div className="shop-card shop-card-skeleton" aria-hidden="true">
      <div className="shop-card-media skeleton-block" />
      <div className="shop-card-body">
        <span className="skeleton-line w-1/3" />
        <span className="skeleton-line w-3/4" />
        <span className="skeleton-line w-full" />
        <span className="skeleton-line w-1/2" />
      </div>
    </div>
  );
}

function ShopProductCard({
  product,
  onSelectProduct,
}: {
  product: PublicProduct;
  onSelectProduct: CatalogueProps["onSelectProduct"];
}) {
  const summary = product.shortDescription ?? product.description;
  return (
    <article className="shop-card">
      <button
        type="button"
        className="shop-card-media"
        tabIndex={-1}
        aria-hidden="true"
        onClick={() => onSelectProduct(product.slug)}
      >
        <ProductImage
          product={product}
          altText={`${product.name} product image`}
          className="shop-card-image"
        />
      </button>
      <div className="shop-card-body">
        <span className="product-category">{product.category.name}</span>
        <h3 className="shop-card-title">{product.name}</h3>
        <p className="shop-card-summary">{summary}</p>
        {summary !== product.description ? <p className="sr-only">{product.description}</p> : null}
        {product.packaging ? (
          <p className="product-packaging">
            {product.packaging.amount} {product.packaging.unit}
          </p>
        ) : null}
        {Number.isSafeInteger(product.priceCents) ? (
          <p className="product-price shop-card-price">{formatZarCents(product.priceCents)}</p>
        ) : null}
        <div className="shop-card-actions">
          <CartAddButton productId={product.id} quantity={1}>
            Add to cart
          </CartAddButton>
          <Button
            variant="ghost"
            className="shop-card-details"
            onClick={() => onSelectProduct(product.slug)}
            aria-label={`View details for ${product.name}`}
          >
            Details <ArrowRight aria-hidden="true" />
          </Button>
        </div>
      </div>
    </article>
  );
}

function ProductListing({
  categoryId,
  page,
  filters,
  onCategoryChange,
  onFiltersChange,
  onPageChange,
  onSelectProduct,
}: ProductListingProps) {
  const categoriesQuery = useQuery({
    queryKey: ["catalogue", "categories"],
    queryFn: () => catalogueApi.getCategories(),
  });
  const productsQuery = useQuery({
    queryKey: ["catalogue", "products", { categoryId, page, filters }],
    queryFn: () => {
      const minPriceCents = filters.minPrice ? parseZarInput(filters.minPrice) : undefined;
      const maxPriceCents = filters.maxPrice ? parseZarInput(filters.maxPrice) : undefined;
      return catalogueApi.getProducts({
        page,
        sortBy: filters.sortBy,
        sortOrder: filters.sortOrder,
        ...(categoryId ? { categoryId } : {}),
        ...(filters.q.trim() ? { q: filters.q.trim() } : {}),
        ...(minPriceCents !== undefined ? { minPriceCents } : {}),
        ...(maxPriceCents !== undefined ? { maxPriceCents } : {}),
      });
    },
    placeholderData: keepPreviousData,
  });
  const categories = categoriesQuery.data?.categories ?? [];
  const productList = productsQuery.data;
  const activeCategory = categories.find((category) => category.id === categoryId);
  const filtered = hasActiveFilters(categoryId, filters);
  const clearAll = () => {
    onCategoryChange(undefined);
    onFiltersChange({ ...filters, q: "", minPrice: "", maxPrice: "" });
  };

  return (
    <>
      <section className="shop-hero" aria-labelledby="shop-hero-title">
        <span className="eyebrow">Healthy Ways SA · Organic natural wellness</span>
        <h2 id="shop-hero-title" className="shop-hero-title">
          Nature&rsquo;s care, <em>delivered gently.</em>
        </h2>
        <p className="shop-hero-copy">
          Browse our trusted natural wellness range — the same personal care you know, now a little
          closer to home. Shop freely; an account is only needed at checkout.
        </p>
        <div className="shop-hero-actions">
          <Button
            className="shop-hero-cta"
            onClick={() => document.getElementById("catalogue-title")?.scrollIntoView({ behavior: "smooth", block: "start" })}
          >
            Shop the catalogue <ArrowRight aria-hidden="true" />
          </Button>
          <a
            className="shop-hero-secondary"
            href="https://wa.me/27796871118"
            target="_blank"
            rel="noreferrer"
          >
            Ask us on WhatsApp
          </a>
        </div>
        <ul className="shop-hero-trust">
          <li><Leaf aria-hidden="true" strokeWidth={1.4} /> Organic natural wellness</li>
          <li><ShieldCheck aria-hidden="true" strokeWidth={1.4} /> Secure checkout</li>
          <li><Truck aria-hidden="true" strokeWidth={1.4} /> Nationwide delivery</li>
        </ul>
      </section>
      <header className="catalogue-header">
        <span className="eyebrow">The Healthy Ways SA shop</span>
        <h2 id="catalogue-title" className="section-title mt-3">
          Explore the catalogue
        </h2>
        <p className="launch-copy mx-auto mt-4">
          Natural wellness essentials, thoughtfully chosen. Search, filter and add to your cart —
          no account needed until checkout.
        </p>
      </header>

      <CatalogueFilters key={`${filters.q}|${filters.minPrice}|${filters.maxPrice}`} filters={filters} onApply={onFiltersChange} />

      {categoriesQuery.isPending ? (
        <div className="category-list" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <span key={i} className="skeleton-pill" />
          ))}
          <span className="sr-only" role="status">Loading categories…</span>
        </div>
      ) : categoriesQuery.isError ? (
        <div className="catalogue-error" role="alert">
          <p>{getErrorMessage(categoriesQuery.error)}</p>
          <Button variant="outline" onClick={() => void categoriesQuery.refetch()}>
            Retry categories
          </Button>
        </div>
      ) : categories.length > 0 ? (
        <nav className="category-list" aria-label="Product categories">
          <button
            type="button"
            className="category-pill"
            aria-pressed={!categoryId}
            onClick={() => onCategoryChange(undefined)}
          >
            All categories
          </button>
          {categories.map((category) => (
            <button
              type="button"
              key={category.id}
              className="category-pill"
              aria-pressed={categoryId === category.id}
              onClick={() => onCategoryChange(category.id)}
            >
              {category.name}
            </button>
          ))}
        </nav>
      ) : (
        <p className="catalogue-note">No categories are available right now.</p>
      )}

      <div className="shop-toolbar">
        <p className="shop-count" aria-live="polite">
          {productList
            ? `${productList.pagination.total} ${productList.pagination.total === 1 ? "product" : "products"}`
            : "\u00a0"}
        </p>
        {filtered ? (
          <div className="active-filters" aria-label="Active filters">
            {activeCategory ? (
              <button type="button" className="filter-chip" onClick={() => onCategoryChange(undefined)}>
                {activeCategory.name} <X aria-hidden="true" />
                <span className="sr-only">Remove category filter</span>
              </button>
            ) : null}
            {filters.q ? (
              <button type="button" className="filter-chip" onClick={() => onFiltersChange({ ...filters, q: "" })}>
                “{filters.q}” <X aria-hidden="true" />
                <span className="sr-only">Clear search</span>
              </button>
            ) : null}
            {filters.minPrice || filters.maxPrice ? (
              <button
                type="button"
                className="filter-chip"
                onClick={() => onFiltersChange({ ...filters, minPrice: "", maxPrice: "" })}
              >
                R{filters.minPrice || "0"} – {filters.maxPrice ? `R${filters.maxPrice}` : "any"}{" "}
                <X aria-hidden="true" />
                <span className="sr-only">Clear price filter</span>
              </button>
            ) : null}
            <button type="button" className="filter-clear" onClick={clearAll}>
              Clear all
            </button>
          </div>
        ) : null}
      </div>

      {productsQuery.isPending ? (
        <>
          <p className="sr-only" role="status" aria-live="polite">
            Loading catalogue…
          </p>
          <div className="shop-grid">
            {Array.from({ length: 6 }, (_, i) => (
              <ProductCardSkeleton key={i} />
            ))}
          </div>
        </>
      ) : productsQuery.isError ? (
        <div className="catalogue-error" role="alert">
          <p>{getErrorMessage(productsQuery.error)}</p>
          <Button variant="outline" onClick={() => void productsQuery.refetch()}>
            Retry catalogue
          </Button>
        </div>
      ) : productList && productList.products.length === 0 ? (
        <div className="shop-empty">
          <Leaf aria-hidden="true" strokeWidth={1.2} />
          <p className="catalogue-note" role="status">
            {filtered
              ? "No products match your current filters."
              : "There are no products in the catalogue right now."}
          </p>
          {filtered ? (
            <Button variant="outline" onClick={clearAll}>
              Clear filters
            </Button>
          ) : null}
        </div>
      ) : productList ? (
        <>
          <div
            className={`shop-grid${productsQuery.isFetching ? " is-refreshing" : ""}`}
            aria-busy={productsQuery.isFetching}
          >
            {productList.products.map((product) => (
              <ShopProductCard key={product.id} product={product} onSelectProduct={onSelectProduct} />
            ))}
          </div>
          {productList.pagination.totalPages > 1 ? (
            <nav className="catalogue-pagination" aria-label="Catalogue pages">
              <Button
                variant="outline"
                disabled={page <= 1}
                onClick={() => onPageChange((currentPage) => currentPage - 1)}
              >
                <ArrowLeft aria-hidden="true" />
                Previous
              </Button>
              <span aria-live="polite">
                Page {productList.pagination.page} of {productList.pagination.totalPages}
              </span>
              <Button
                variant="outline"
                disabled={page >= productList.pagination.totalPages}
                onClick={() => onPageChange((currentPage) => currentPage + 1)}
              >
                Next
                <ArrowRight aria-hidden="true" />
              </Button>
            </nav>
          ) : null}
        </>
      ) : null}
    </>
  );
}

function parseZarInput(value: string): number | undefined {
  const normalized = value.trim();
  if (!normalized) return undefined;
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) return undefined;
  const [whole, fraction = ""] = normalized.split(".");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(cents) ? cents : undefined;
}

function CatalogueFilters({
  filters,
  onApply,
}: {
  filters: ProductListingProps["filters"];
  onApply: ProductListingProps["onFiltersChange"];
}) {
  const [draft, setDraft] = useState(filters);
  const [showMore, setShowMore] = useState(Boolean(filters.minPrice || filters.maxPrice));
  const [validationMessage, setValidationMessage] = useState<string | null>(null);
  const latest = useRef({ filters, onApply });
  latest.current = { filters, onApply };

  // Live search: apply the search term shortly after the customer stops typing.
  useEffect(() => {
    const term = draft.q.trim();
    if (term === latest.current.filters.q) return;
    const timer = window.setTimeout(() => {
      latest.current.onApply({ ...latest.current.filters, q: term });
    }, 450);
    return () => window.clearTimeout(timer);
  }, [draft.q]);

  function applySort(next: Partial<Pick<typeof draft, "sortBy" | "sortOrder">>) {
    const updated = { ...draft, ...next };
    setDraft(updated);
    onApply({ ...filters, sortBy: updated.sortBy, sortOrder: updated.sortOrder });
  }

  return (
    <form
      className="shop-filters"
      role="search"
      onSubmit={(event) => {
        event.preventDefault();
        const minimum = draft.minPrice.trim() ? parseZarInput(draft.minPrice) : undefined;
        const maximum = draft.maxPrice.trim() ? parseZarInput(draft.maxPrice) : undefined;
        if (
          (draft.minPrice.trim() && minimum === undefined) ||
          (draft.maxPrice.trim() && maximum === undefined)
        ) {
          setValidationMessage("Enter prices with up to two decimal places.");
          setShowMore(true);
          return;
        }
        if (minimum !== undefined && maximum !== undefined && minimum > maximum) {
          setValidationMessage("The minimum price must not exceed the maximum price.");
          setShowMore(true);
          return;
        }
        setValidationMessage(null);
        onApply({ ...draft, q: draft.q.trim(), minPrice: draft.minPrice.trim(), maxPrice: draft.maxPrice.trim() });
      }}
    >
      <div className="shop-filters-row">
        <label className="shop-search">
          <span className="sr-only">Search products</span>
          <Search aria-hidden="true" />
          <input
            type="search"
            placeholder="Search products…"
            value={draft.q}
            maxLength={100}
            onChange={(event) => setDraft({ ...draft, q: event.currentTarget.value })}
          />
        </label>
        <label className="shop-select">
          <span>Sort by</span>
          <select
            value={draft.sortBy}
            onChange={(event) => {
              const sortBy = event.currentTarget.value;
              if (isProductSortField(sortBy)) applySort({ sortBy });
            }}
          >
            <option value="name">Name</option>
            <option value="priceCents">Price</option>
            <option value="createdAt">Recently added</option>
          </select>
        </label>
        <label className="shop-select">
          <span>Sort order</span>
          <select
            value={draft.sortOrder}
            onChange={(event) => {
              const sortOrder = event.currentTarget.value;
              if (isProductSortOrder(sortOrder)) applySort({ sortOrder });
            }}
          >
            <option value="asc">Ascending</option>
            <option value="desc">Descending</option>
          </select>
        </label>
        <button
          type="button"
          className="shop-more"
          aria-expanded={showMore}
          onClick={() => setShowMore((open) => !open)}
        >
          <SlidersHorizontal aria-hidden="true" /> Price
        </button>
      </div>
      <div className="shop-filters-more" data-open={showMore}>
        <label>
          Minimum price (ZAR)
          <input
            inputMode="decimal"
            placeholder="0"
            value={draft.minPrice}
            onChange={(event) => setDraft({ ...draft, minPrice: event.currentTarget.value })}
          />
        </label>
        <label>
          Maximum price (ZAR)
          <input
            inputMode="decimal"
            placeholder="Any"
            value={draft.maxPrice}
            onChange={(event) => setDraft({ ...draft, maxPrice: event.currentTarget.value })}
          />
        </label>
        <Button type="submit">Apply filters</Button>
      </div>
      {validationMessage ? (
        <p className="catalogue-filter-error" role="alert">
          {validationMessage}
        </p>
      ) : null}
    </form>
  );
}

function ProductDetail({
  slug,
  onBackToCatalogue,
}: Pick<CatalogueProps, "onBackToCatalogue"> & { slug: string }) {
  const productQuery = useQuery({
    queryKey: ["catalogue", "product", slug],
    queryFn: () => catalogueApi.getProductBySlug(slug),
  });

  return (
    <>
      <Button variant="ghost" className="catalogue-back" onClick={onBackToCatalogue}>
        <ArrowLeft aria-hidden="true" />
        Back to catalogue
      </Button>
      {productQuery.isPending ? (
        <p className="catalogue-status" role="status" aria-live="polite">
          Loading product…
        </p>
      ) : productQuery.isError ? (
        <div className="catalogue-error" role="alert">
          <p>
            {productQuery.error instanceof ApiHttpError && productQuery.error.status === 404
              ? "This product is not currently available."
              : getErrorMessage(productQuery.error)}
          </p>
          {!(productQuery.error instanceof ApiHttpError && productQuery.error.status === 404) ? (
            <Button variant="outline" onClick={() => void productQuery.refetch()}>
              Retry product
            </Button>
          ) : null}
        </div>
      ) : productQuery.data ? (
        <article className="product-detail">
          <div className="product-gallery" aria-label={`${productQuery.data.product.name} images`}>
            {getProductGallery(productQuery.data.product).length > 0 ? (
              getProductGallery(productQuery.data.product).map((imageUrl, index) => (
                <ProductGalleryImage
                  key={`${productQuery.data.product.id}-${imageUrl}`}
                  productName={productQuery.data.product.name}
                  imageUrl={imageUrl}
                  index={index}
                />
              ))
            ) : (
              <div
                className="product-image-placeholder product-detail-placeholder"
                role="img"
                aria-label={`${productQuery.data.product.name} image unavailable`}
              >
                <span>Image unavailable</span>
              </div>
            )}
          </div>
          <span className="product-category">{productQuery.data.product.category.name}</span>
          <h2 id="catalogue-title" className="section-title mt-3">
            {productQuery.data.product.name}
          </h2>
          <p className="product-detail-description">{productQuery.data.product.description}</p>
          {Number.isSafeInteger(productQuery.data.product.priceCents) ? (
            <p className="product-detail-price">
              {formatZarCents(productQuery.data.product.priceCents)}
            </p>
          ) : null}
          {productQuery.data.product.packaging ? (
            <p className="product-packaging">
              {productQuery.data.product.packaging.amount}{" "}
              {productQuery.data.product.packaging.unit}
            </p>
          ) : null}
          <div className="product-detail-actions">
            <CartAddButton productId={productQuery.data.product.id} quantity={1}>
              Add to cart
            </CartAddButton>
          </div>
          <p className="product-detail-note">
            <Leaf aria-hidden="true" size={16} />
            Product information is provided as published in the catalogue.
          </p>
        </article>
      ) : null}
    </>
  );
}
