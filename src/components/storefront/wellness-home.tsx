import { useQuery } from "@tanstack/react-query";
import {
  ArrowDown,
  ArrowRight,
  BookOpen,
  Check,
  Compass,
  Leaf,
  Menu,
  Search,
  Sparkles,
  X,
} from "lucide-react";
import { useRef, useState } from "react";

import { CartAddButton, CartTrigger } from "@/components/storefront/cart";
import { Catalogue } from "@/components/storefront/catalogue";
import { Button } from "@/components/ui/button";
import { catalogueApi, type PublicProduct } from "@/lib/api/catalogue";
import { getAllowedProductImageUrls } from "@/lib/image-url";
import { formatZarCents } from "@/lib/money";
import { Brand, ContactActions } from "@/components/wellness";

const wellnessThemes = [
  {
    name: "Calm",
    note: "Make a little room for quieter moments.",
    detail:
      "Explore familiar botanicals and thoughtful daily rituals that can help you shape a gentler pace. Everyone’s routine is personal; choose what feels right for yours.",
  },
  {
    name: "Focus",
    note: "Bring intention to the everyday.",
    detail:
      "Small, steady routines can make a day feel more considered. Discover ingredients, read their labels, and find a simple rhythm that fits your life.",
  },
  {
    name: "Everyday wellness",
    note: "Thoughtful choices, made your own.",
    detail:
      "Wellbeing is personal and changes with the seasons. Start with curiosity, explore our catalogue, and make informed choices at your own pace.",
  },
  {
    name: "Vitality",
    note: "A fresh perspective on daily care.",
    detail:
      "From longstanding botanicals to contemporary essentials, learn about the ingredients in our range and how each product is described on its label.",
  },
  {
    name: "Rest & recovery",
    note: "Let your evenings find their own pace.",
    detail:
      "Build a wind-down ritual that feels comfortable and sustainable. Our ingredient notes offer a starting point for learning, not medical advice or promises.",
  },
];

const ingredientNotes = [
  { name: "Moringa", note: "A leafy botanical with a long history of use in food and traditional practices." },
  { name: "Lion’s Mane", note: "A distinctive culinary mushroom, recognised for its cascading, icicle-like form." },
  { name: "Ashwagandha", note: "An herb with a long history in traditional wellness practices." },
  { name: "Magnesium", note: "An essential mineral found in food and used in a variety of supplement formats." },
];

function scrollToSection(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function FeaturedProduct({ product, onSelect }: { product: PublicProduct; onSelect: (slug: string) => void }) {
  const image = getAllowedProductImageUrls(product.imageReferences)[0];
  return (
    <article className="home-product">
      <button
        className="home-product-image-button"
        type="button"
        aria-label={`View details for ${product.name}`}
        onClick={() => onSelect(product.slug)}
      >
        {image ? (
          <img className="home-product-image" src={image} alt={`${product.name} product`} loading="lazy" />
        ) : (
          <span className="home-product-image-empty" role="img" aria-label={`${product.name} image unavailable`}>
            <Leaf aria-hidden="true" />
          </span>
        )}
        <span className="home-product-view">Explore <ArrowRight aria-hidden="true" /></span>
      </button>
      <div className="home-product-copy">
        <p className="home-product-category">{product.category.name}</p>
        <button type="button" className="home-product-name" onClick={() => onSelect(product.slug)}>
          {product.name}
        </button>
        {product.shortDescription ? <p className="home-product-description">{product.shortDescription}</p> : null}
        <div className="home-product-buy">
          <span>{formatZarCents(product.priceCents)}</span>
          <CartAddButton productId={product.id} quantity={1}>
            Add to cart
          </CartAddButton>
        </div>
      </div>
    </article>
  );
}

export function WellnessHome({ onSelectProduct }: { onSelectProduct: (slug: string) => void }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [activeTheme, setActiveTheme] = useState(0);
  const [activeIngredient, setActiveIngredient] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);
  const featuredQuery = useQuery({
    queryKey: ["catalogue", "homepage-featured"],
    queryFn: () => catalogueApi.getProducts({ page: 1, limit: 4, sortBy: "name", sortOrder: "asc" }),
    staleTime: 60_000,
  });
  const featuredProducts = featuredQuery.data?.products ?? [];

  const navigateTo = (id: string) => {
    setMenuOpen(false);
    scrollToSection(id);
  };

  return (
    <div className="wellness-home">
      <header className="wellness-header">
        <a className="wellness-brand" href="/preview" aria-label="Healthy Ways SA home">
          <Brand className="w-[128px]" />
        </a>
        <nav className="wellness-nav wellness-nav-desktop" aria-label="Main navigation">
          <button type="button" onClick={() => navigateTo("home")}>Home</button>
          <button type="button" onClick={() => navigateTo("catalogue")}>Shop</button>
          <button type="button" onClick={() => navigateTo("discover")}>Discover</button>
          <button type="button" onClick={() => navigateTo("our-story")}>Our Story</button>
          <button type="button" onClick={() => navigateTo("contact")}>Contact</button>
        </nav>
        <div className="wellness-header-actions">
          <Button type="button" variant="ghost" className="wellness-icon-button" aria-label="Search products" onClick={() => {
            navigateTo("catalogue");
            window.setTimeout(() => searchRef.current?.focus(), 350);
          }}>
            <Search aria-hidden="true" />
          </Button>
          <Button type="button" variant="ghost" className="wellness-icon-button wellness-account-button" aria-label="My account" onClick={() => window.location.assign("/account/login")}>
            <Compass aria-hidden="true" />
          </Button>
          <CartTrigger />
          <Button
            type="button"
            variant="ghost"
            className="wellness-icon-button wellness-menu-toggle"
            aria-label={menuOpen ? "Close navigation menu" : "Open navigation menu"}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
          >
            {menuOpen ? <X aria-hidden="true" /> : <Menu aria-hidden="true" />}
          </Button>
        </div>
        {menuOpen ? (
          <nav className="wellness-mobile-nav" aria-label="Mobile navigation">
            {[
              ["Home", "home"],
              ["Shop", "catalogue"],
              ["Discover", "discover"],
              ["Our Story", "our-story"],
              ["Contact", "contact"],
            ].map(([label, id]) => (
              <button type="button" key={id} onClick={() => navigateTo(id)}>{label}<ArrowRight aria-hidden="true" /></button>
            ))}
            <button type="button" onClick={() => window.location.assign("/account/login")}>My account<ArrowRight aria-hidden="true" /></button>
          </nav>
        ) : null}
      </header>

      <main>
        <section className="wellness-hero" id="home" aria-labelledby="home-title">
          <img className="wellness-hero-image" src="/images/wellness-home-hero.jpg" alt="Sunlit botanical leaves, a natural stone table and an amber wellness jar" width={1920} height={1120} fetchPriority="high" />
          <div className="wellness-hero-shade" aria-hidden="true" />
          <div className="wellness-hero-content">
            <p className="wellness-eyebrow"><span /> Healthy Ways SA · Natural wellness</p>
            <h1 id="home-title">Find your<br /><em>natural rhythm.</em></h1>
            <p className="wellness-hero-description">Thoughtfully selected wellness essentials to support a more intentional everyday.</p>
            <div className="wellness-hero-actions">
              <Button type="button" className="wellness-primary-button" onClick={() => navigateTo("catalogue")}>
                Explore the collection <ArrowRight aria-hidden="true" />
              </Button>
              <button type="button" className="wellness-text-link" onClick={() => navigateTo("ingredients")}>
                Discover our ingredients <ArrowDown aria-hidden="true" />
              </button>
            </div>
          </div>
          <div className="wellness-hero-index"><span>01</span><span className="wellness-index-rule" /><span>Everyday, more intentional</span></div>
        </section>

        <section className="wellness-discovery" id="discover" aria-labelledby="discovery-title">
          <div className="wellness-section-kicker"><Sparkles aria-hidden="true" /> A moment for you</div>
          <div className="wellness-discovery-layout">
            <div className="wellness-section-intro">
              <h2 id="discovery-title">What does your<br /><em>day need?</em></h2>
              <p>Wellness is personal. Begin with a feeling, then explore at your own pace.</p>
            </div>
            <div className="wellness-theme-explorer">
              <div className="wellness-theme-tabs" role="tablist" aria-label="Wellness themes">
                {wellnessThemes.map((theme, index) => (
                  <Button
                    key={theme.name}
                    id={`wellness-tab-${index}`}
                    type="button"
                    role="tab"
                    aria-selected={activeTheme === index}
                    aria-controls="wellness-theme-panel"
                    variant="ghost"
                    className="wellness-theme-tab"
                    onClick={() => setActiveTheme(index)}
                  >
                    {theme.name}
                  </Button>
                ))}
              </div>
              <div className="wellness-theme-panel" id="wellness-theme-panel" role="tabpanel" aria-labelledby={`wellness-tab-${activeTheme}`}>
                <span className="wellness-panel-number">0{activeTheme + 1}</span>
                <div>
                  <h3>{wellnessThemes[activeTheme].note}</h3>
                  <p>{wellnessThemes[activeTheme].detail}</p>
                  <button type="button" className="wellness-inline-link" onClick={() => navigateTo("catalogue")}>Explore the shop <ArrowRight aria-hidden="true" /></button>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="wellness-featured" id="featured" aria-labelledby="featured-title">
          <div className="wellness-section-heading">
            <div>
              <p className="wellness-eyebrow">Selected for your everyday</p>
              <h2 id="featured-title">A considered <em>collection.</em></h2>
            </div>
            <button type="button" className="wellness-inline-link" onClick={() => navigateTo("catalogue")}>View the full collection <ArrowRight aria-hidden="true" /></button>
          </div>
          {featuredQuery.isPending ? (
            <div className="wellness-featured-grid" aria-label="Loading featured products" aria-busy="true">
              {Array.from({ length: 4 }, (_, index) => <div className="wellness-featured-skeleton" key={index} />)}
            </div>
          ) : featuredQuery.isError ? (
            <div className="wellness-featured-message" role="status">
              The collection is taking a moment to load. Browse the full catalogue below or try again shortly.
            </div>
          ) : featuredProducts.length ? (
            <div className="wellness-featured-grid">
              {featuredProducts.map((product) => <FeaturedProduct key={product.id} product={product} onSelect={onSelectProduct} />)}
            </div>
          ) : (
            <div className="wellness-featured-message" role="status">There are no products available to feature right now.</div>
          )}
        </section>

        <section className="wellness-ingredient-section" id="ingredients" aria-labelledby="ingredient-title">
          <div className="wellness-ingredient-photo">
            <img src="/images/wellness-botanicals.jpg" alt="Moringa leaves, powdered botanicals and an amber glass jar on natural stone" width={1504} height={1200} loading="lazy" />
            <span className="wellness-photo-caption">A closer look at nature’s details</span>
          </div>
          <div className="wellness-ingredient-content">
            <p className="wellness-eyebrow">Learn, explore, choose</p>
            <h2 id="ingredient-title">Rooted in<br /><em>curiosity.</em></h2>
            <p className="wellness-ingredient-lede">Every ingredient has a story. Get to know a few of the botanicals and essentials found across our range.</p>
            <div className="wellness-ingredient-list" role="tablist" aria-label="Explore ingredients">
              {ingredientNotes.map((ingredient, index) => (
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeIngredient === index}
                  aria-controls="ingredient-note"
                  key={ingredient.name}
                  onClick={() => setActiveIngredient(index)}
                >
                  <span>0{index + 1}</span>{ingredient.name}<ArrowRight aria-hidden="true" />
                </button>
              ))}
            </div>
            <div className="wellness-ingredient-note" id="ingredient-note" role="tabpanel">
              <Leaf aria-hidden="true" />
              <p>{ingredientNotes[activeIngredient].note}</p>
            </div>
          </div>
        </section>

        <section className="wellness-story" id="our-story" aria-labelledby="story-title">
          <div className="wellness-story-mark" aria-hidden="true"><Leaf /><span>HWSA</span></div>
          <p className="wellness-eyebrow">A more intentional everyday</p>
          <h2 id="story-title">Carefully chosen.<br /><em>Close to nature.</em></h2>
          <p>Healthy Ways SA brings together natural wellness essentials with a personal, considered approach. Explore our range, take time to learn, and choose what feels right for you.</p>
          <button type="button" className="wellness-inline-link" onClick={() => navigateTo("catalogue")}>Get to know the range <ArrowRight aria-hidden="true" /></button>
        </section>

        <section className="wellness-journal" aria-labelledby="journal-title">
          <div className="wellness-journal-copy">
            <p className="wellness-eyebrow"><BookOpen aria-hidden="true" /> The art of knowing</p>
            <h2 id="journal-title">A little more<br /><em>to discover.</em></h2>
            <p>Explore our ingredient notes and product details to make choices with care. Start with what interests you; there’s always more to learn.</p>
            <button type="button" className="wellness-inline-link" onClick={() => navigateTo("ingredients")}>Explore ingredient notes <ArrowRight aria-hidden="true" /></button>
          </div>
          <button type="button" className="wellness-journal-image" onClick={() => navigateTo("ingredients")} aria-label="Explore botanical ingredient notes">
            <img src="/images/wellness-botanicals.jpg" alt="Botanical leaves and a natural wellness jar" width={1504} height={1200} loading="lazy" />
            <span>Botanical notes <ArrowRight aria-hidden="true" /></span>
          </button>
        </section>

        <section className="wellness-catalogue" id="catalogue" aria-label="Shop all products">
          <div className="wellness-catalogue-heading">
            <p className="wellness-eyebrow">Find your everyday essential</p>
            <h2>Explore the <em>collection.</em></h2>
            <p>Browse our current range, search by name, or narrow your selection by category and price.</p>
          </div>
          <Catalogue selectedSlug={undefined} onSelectProduct={onSelectProduct} onBackToCatalogue={() => navigateTo("catalogue")} />
        </section>
      </main>

      <footer className="wellness-footer" id="contact">
        <div className="wellness-footer-top">
          <div><p className="wellness-eyebrow">A gentler way to shop</p><h2>Find your<br /><em>natural rhythm.</em></h2></div>
          <Button type="button" className="wellness-primary-button" onClick={() => navigateTo("catalogue")}>Explore the collection <ArrowRight aria-hidden="true" /></Button>
        </div>
        <div className="wellness-footer-bottom">
          <Brand className="w-[118px]" />
          <ContactActions />
          <span>© 2026 Healthy Ways SA</span>
        </div>
      </footer>
      <span className="sr-only"><Check aria-hidden="true" /></span>
    </div>
  );
}