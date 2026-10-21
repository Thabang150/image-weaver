import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, Leaf } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
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

  return (
    <>
      <header className="catalogue-header">
        <span className="eyebrow">Healthy Ways SA</span>
        <h2 id="catalogue-title" className="section-title mt-3">
          Explore the catalogue
        </h2>
        <p className="launch-copy mx-auto mt-4">
          Browse the products currently available in our catalogue.
        </p>
      </header>

      <CatalogueFilters filters={filters} onApply={onFiltersChange} />

      {categoriesQuery.isPending ? (
        <p className="catalogue-status" role="status">
          Loading categories…
        </p>
      ) : categoriesQuery.isError ? (
        <div className="catalogue-error" role="alert">
          <p>{getErrorMessage(categoriesQuery.error)}</p>
          <Button variant="outline" onClick={() => void categoriesQuery.refetch()}>
            Retry categories
          </Button>
        </div>
      ) : categories.length > 0 ? (
        <nav className="category-list" aria-label="Product categories">
          <Button
            variant={categoryId ? "outline" : "secondary"}
            aria-pressed={!categoryId}
            onClick={() => onCategoryChange(undefined)}
          >
            All categories
          </Button>
          {categories.map((category) => (
            <Button
              key={category.id}
              variant={categoryId === category.id ? "secondary" : "outline"}
              aria-pressed={categoryId === category.id}
              onClick={() => onCategoryChange(category.id)}
            >
              {category.name}
            </Button>
          ))}
        </nav>
      ) : (
        <p className="catalogue-note">No categories are available right now.</p>
      )}

      {productsQuery.isPending ? (
        <p className="catalogue-status" role="status" aria-live="polite">
          Loading catalogue…
        </p>
      ) : productsQuery.isError ? (
        <div className="catalogue-error" role="alert">
          <p>{getErrorMessage(productsQuery.error)}</p>
          <Button variant="outline" onClick={() => void productsQuery.refetch()}>
            Retry catalogue
          </Button>
        </div>
      ) : productList && productList.products.length === 0 ? (
        <p className="catalogue-note" role="status">
          {categoryId || filters.q || filters.minPrice || filters.maxPrice
            ? "No products match your current filters."
            : "There are no products in the catalogue right now."}
        </p>
      ) : productList ? (
        <>
          <div className="product-grid" aria-busy={productsQuery.isFetching}>
            {productList.products.map((product) => (
              <Card className="product-card" key={product.id}>
                <div className="product-card-media">
                  <ProductImage
                    product={product}
                    altText={`${product.name} product image`}
                    className="product-card-image"
                  />
                </div>
                <CardHeader>
                  <span className="product-category">{product.category.name}</span>
                  <CardTitle className="font-display text-2xl font-medium">
                    {product.name}
                  </CardTitle>
                </CardHeader>
                <CardContent className="product-card-content">
                  <p>{product.description}</p>
                  {Number.isSafeInteger(product.priceCents) ? (
                    <p className="product-price">{formatZarCents(product.priceCents)}</p>
                  ) : null}
                  {product.packaging ? (
                    <p className="product-packaging">
                      {product.packaging.amount} {product.packaging.unit}
                    </p>
                  ) : null}
                </CardContent>
                <CardFooter className="product-card-actions">
                  <CartAddButton productId={product.id} quantity={1}>
                    Add to cart
                  </CartAddButton>
                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={() => onSelectProduct(product.slug)}
                    aria-label={`View details for ${product.name}`}
                  >
                    View details
                  </Button>
                </CardFooter>
              </Card>
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
  const [validationMessage, setValidationMessage] = useState<string | null>(null);

  return (
    <form
      className="catalogue-filters"
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
          return;
        }
        if (minimum !== undefined && maximum !== undefined && minimum > maximum) {
          setValidationMessage("The minimum price must not exceed the maximum price.");
          return;
        }
        setValidationMessage(null);
        onApply({ ...draft, q: draft.q.trim() });
      }}
    >
      <label>
        Search products
        <input
          type="search"
          value={draft.q}
          maxLength={100}
          onChange={(event) => setDraft({ ...draft, q: event.currentTarget.value })}
        />
      </label>
      <label>
        Minimum price (ZAR)
        <input
          inputMode="decimal"
          value={draft.minPrice}
          onChange={(event) => setDraft({ ...draft, minPrice: event.currentTarget.value })}
        />
      </label>
      <label>
        Maximum price (ZAR)
        <input
          inputMode="decimal"
          value={draft.maxPrice}
          onChange={(event) => setDraft({ ...draft, maxPrice: event.currentTarget.value })}
        />
      </label>
      <label>
        Sort by
        <select
          value={draft.sortBy}
          onChange={(event) => {
            const sortBy = event.currentTarget.value;
            if (isProductSortField(sortBy)) setDraft({ ...draft, sortBy });
          }}
        >
          <option value="name">Name</option>
          <option value="priceCents">Price</option>
          <option value="createdAt">Recently added</option>
        </select>
      </label>
      <label>
        Sort order
        <select
          value={draft.sortOrder}
          onChange={(event) => {
            const sortOrder = event.currentTarget.value;
            if (isProductSortOrder(sortOrder)) setDraft({ ...draft, sortOrder });
          }}
        >
          <option value="asc">Ascending</option>
          <option value="desc">Descending</option>
        </select>
      </label>
      <Button type="submit" variant="secondary">
        Apply filters
      </Button>
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
