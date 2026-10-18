import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, Leaf } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { ApiHttpError, ApiResponseError } from "@/lib/api/client";
import { catalogueApi, type PublicProduct } from "@/lib/api/catalogue";
import { formatZarCents } from "@/lib/money";

function getPrimaryImageUrl(product: PublicProduct): string | undefined {
  const urls = product.imageReferences.filter((value) => {
    try {
      const parsed = new URL(value);
      return parsed.protocol === "https:" && parsed.hostname.length > 0;
    } catch {
      return false;
    }
  });
  return urls[0];
}

function getProductGallery(product: PublicProduct): string[] {
  return product.imageReferences.filter((value) => {
    try {
      const parsed = new URL(value);
      return parsed.protocol === "https:" && parsed.hostname.length > 0;
    } catch {
      return false;
    }
  });
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

interface CatalogueProps {
  selectedSlug?: string | undefined;
  onSelectProduct: (slug: string) => void;
  onBackToCatalogue: () => void;
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

  return (
    <section id="catalogue" className="catalogue-section" aria-labelledby="catalogue-title">
      {selectedSlug ? (
        <ProductDetail slug={selectedSlug} onBackToCatalogue={onBackToCatalogue} />
      ) : (
        <ProductListing
          categoryId={categoryId}
          page={page}
          onCategoryChange={(nextCategoryId) => {
            setCategoryId(nextCategoryId);
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
  onCategoryChange: (categoryId: string | undefined) => void;
  onPageChange: (page: number | ((previousPage: number) => number)) => void;
  onSelectProduct: CatalogueProps["onSelectProduct"];
}

function ProductListing({
  categoryId,
  page,
  onCategoryChange,
  onPageChange,
  onSelectProduct,
}: ProductListingProps) {
  const categoriesQuery = useQuery({
    queryKey: ["catalogue", "categories"],
    queryFn: () => catalogueApi.getCategories(),
  });
  const productsQuery = useQuery({
    queryKey: ["catalogue", "products", { categoryId, page }],
    queryFn: () => catalogueApi.getProducts({ page, ...(categoryId ? { categoryId } : {}) }),
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
          {categoryId
            ? "There are no products in this category yet."
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
                <CardFooter>
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
                <img
                  key={`${productQuery.data.product.id}-${imageUrl}`}
                  src={imageUrl}
                  alt={`${productQuery.data.product.name} image ${index + 1}`}
                  className="product-detail-image"
                  loading="lazy"
                  onError={(event) => {
                    event.currentTarget.style.display = "none";
                  }}
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
          <p className="product-detail-note">
            <Leaf aria-hidden="true" size={16} />
            Product information is provided as published in the catalogue.
          </p>
        </article>
      ) : null}
    </>
  );
}
