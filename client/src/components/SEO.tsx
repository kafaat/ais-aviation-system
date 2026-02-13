import { useEffect } from "react";

interface SEOProps {
  title: string;
  description?: string;
  keywords?: string;
  ogTitle?: string;
  ogDescription?: string;
  ogImage?: string;
  ogUrl?: string;
  twitterCard?: "summary" | "summary_large_image";
}

/**
 * SEO Component for managing document meta tags
 * Updates document title and meta tags for better search engine optimization
 */
export function SEO({
  title,
  description,
  keywords,
  ogTitle,
  ogDescription,
  ogImage,
  ogUrl,
  twitterCard = "summary",
}: SEOProps) {
  useEffect(() => {
    // Update document title
    const baseTitle = "AIS Aviation";
    document.title = title ? `${title} | ${baseTitle}` : baseTitle;

    // Helper to update or create meta tag
    const updateMetaTag = (
      name: string,
      content: string,
      isProperty = false
    ) => {
      const attribute = isProperty ? "property" : "name";
      let element = document.querySelector(
        `meta[${attribute}="${name}"]`
      ) as HTMLMetaElement | null;

      if (content) {
        if (!element) {
          element = document.createElement("meta");
          element.setAttribute(attribute, name);
          document.head.appendChild(element);
        }
        element.setAttribute("content", content);
      } else if (element) {
        element.remove();
      }
    };

    // Update standard meta tags
    if (description) {
      updateMetaTag("description", description);
    }
    if (keywords) {
      updateMetaTag("keywords", keywords);
    }

    // Update Open Graph tags
    updateMetaTag("og:title", ogTitle || title, true);
    if (ogDescription || description) {
      updateMetaTag("og:description", ogDescription || description || "", true);
    }
    if (ogImage) {
      updateMetaTag("og:image", ogImage, true);
    }
    if (ogUrl) {
      updateMetaTag("og:url", ogUrl, true);
    }
    updateMetaTag("og:type", "website", true);
    updateMetaTag("og:site_name", "AIS Aviation", true);

    // Update Twitter Card tags
    updateMetaTag("twitter:card", twitterCard);
    updateMetaTag("twitter:title", ogTitle || title);
    if (ogDescription || description) {
      updateMetaTag("twitter:description", ogDescription || description || "");
    }
    if (ogImage) {
      updateMetaTag("twitter:image", ogImage);
    }

    // Cleanup function to reset title on unmount
    return () => {
      document.title = baseTitle;
    };
  }, [
    title,
    description,
    keywords,
    ogTitle,
    ogDescription,
    ogImage,
    ogUrl,
    twitterCard,
  ]);

  // This component doesn't render anything visible
  return null;
}

export default SEO;
