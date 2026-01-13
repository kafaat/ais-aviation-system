import { eq, and } from "drizzle-orm";
import { getDb } from "../db";
import {
  translations,
  contentTypes,
  type InsertTranslation,
  type SupportedLocale,
  DEFAULT_LOCALE,
  FALLBACK_LOCALE,
} from "../../drizzle/schema-i18n";

/**
 * i18n Service
 * Handles dynamic content translation
 */

/**
 * Get translation for a specific entity field
 */
export async function getTranslation(
  contentType: string,
  entityId: number,
  fieldName: string,
  locale: SupportedLocale = DEFAULT_LOCALE
): Promise<string | null> {
  const db = await getDb();
  if (!db) return null;

  // Get content type ID
  const contentTypeRecord = await db
    .select()
    .from(contentTypes)
    .where(eq(contentTypes.name, contentType))
    .limit(1);

  if (contentTypeRecord.length === 0) return null;

  const contentTypeId = contentTypeRecord[0].id;

  // Try to get translation for requested locale
  const translation = await db
    .select()
    .from(translations)
    .where(
      and(
        eq(translations.contentTypeId, contentTypeId),
        eq(translations.entityId, entityId),
        eq(translations.fieldName, fieldName),
        eq(translations.locale, locale),
        eq(translations.isApproved, true)
      )
    )
    .limit(1);

  if (translation.length > 0) {
    return translation[0].value;
  }

  // Fallback to FALLBACK_LOCALE if not found
  if (locale !== FALLBACK_LOCALE) {
    const fallbackTranslation = await db
      .select()
      .from(translations)
      .where(
        and(
          eq(translations.contentTypeId, contentTypeId),
          eq(translations.entityId, entityId),
          eq(translations.fieldName, fieldName),
          eq(translations.locale, FALLBACK_LOCALE),
          eq(translations.isApproved, true)
        )
      )
      .limit(1);

    if (fallbackTranslation.length > 0) {
      return fallbackTranslation[0].value;
    }
  }

  return null;
}

/**
 * Get all translations for an entity
 */
export async function getEntityTranslations(
  contentType: string,
  entityId: number,
  locale: SupportedLocale = DEFAULT_LOCALE
): Promise<Record<string, string>> {
  const db = await getDb();
  if (!db) return {};

  // Get content type ID
  const contentTypeRecord = await db
    .select()
    .from(contentTypes)
    .where(eq(contentTypes.name, contentType))
    .limit(1);

  if (contentTypeRecord.length === 0) return {};

  const contentTypeId = contentTypeRecord[0].id;

  // Get all translations for this entity and locale
  const entityTranslations = await db
    .select()
    .from(translations)
    .where(
      and(
        eq(translations.contentTypeId, contentTypeId),
        eq(translations.entityId, entityId),
        eq(translations.locale, locale),
        eq(translations.isApproved, true)
      )
    );

  // Convert to key-value object
  const result: Record<string, string> = {};
  for (const trans of entityTranslations) {
    result[trans.fieldName] = trans.value;
  }

  return result;
}

/**
 * Set translation for a specific entity field
 */
export async function setTranslation(
  contentType: string,
  entityId: number,
  fieldName: string,
  locale: SupportedLocale,
  value: string,
  translatedBy: string = "system"
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // Get or create content type
  let contentTypeRecord = await db
    .select()
    .from(contentTypes)
    .where(eq(contentTypes.name, contentType))
    .limit(1);

  let contentTypeId: number;

  if (contentTypeRecord.length === 0) {
    // Create content type
    const result = await db.insert(contentTypes).values({
      name: contentType,
      description: `Auto-created for ${contentType}`,
    });
    contentTypeId = Number(result.insertId);
  } else {
    contentTypeId = contentTypeRecord[0].id;
  }

  // Check if translation already exists
  const existing = await db
    .select()
    .from(translations)
    .where(
      and(
        eq(translations.contentTypeId, contentTypeId),
        eq(translations.entityId, entityId),
        eq(translations.fieldName, fieldName),
        eq(translations.locale, locale)
      )
    )
    .limit(1);

  if (existing.length > 0) {
    // Update existing translation
    await db
      .update(translations)
      .set({
        value,
        translatedBy,
        updatedAt: new Date(),
      })
      .where(eq(translations.id, existing[0].id));
  } else {
    // Insert new translation
    await db.insert(translations).values({
      contentTypeId,
      entityId,
      fieldName,
      locale,
      value,
      translatedBy,
    });
  }
}

/**
 * Bulk set translations for an entity
 */
export async function setEntityTranslations(
  contentType: string,
  entityId: number,
  locale: SupportedLocale,
  translations: Record<string, string>,
  translatedBy: string = "system"
): Promise<void> {
  for (const [fieldName, value] of Object.entries(translations)) {
    await setTranslation(
      contentType,
      entityId,
      fieldName,
      locale,
      value,
      translatedBy
    );
  }
}

/**
 * Delete translation
 */
export async function deleteTranslation(
  contentType: string,
  entityId: number,
  fieldName: string,
  locale: SupportedLocale
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const contentTypeRecord = await db
    .select()
    .from(contentTypes)
    .where(eq(contentTypes.name, contentType))
    .limit(1);

  if (contentTypeRecord.length === 0) return;

  const contentTypeId = contentTypeRecord[0].id;

  // Note: Drizzle delete syntax may vary based on version
  // This is a placeholder - adjust based on your Drizzle version
  await db
    .delete(translations)
    .where(
      and(
        eq(translations.contentTypeId, contentTypeId),
        eq(translations.entityId, entityId),
        eq(translations.fieldName, fieldName),
        eq(translations.locale, locale)
      )
    );
}

/**
 * Get all available locales for an entity
 */
export async function getAvailableLocales(
  contentType: string,
  entityId: number
): Promise<SupportedLocale[]> {
  const db = await getDb();
  if (!db) return [];

  const contentTypeRecord = await db
    .select()
    .from(contentTypes)
    .where(eq(contentTypes.name, contentType))
    .limit(1);

  if (contentTypeRecord.length === 0) return [];

  const contentTypeId = contentTypeRecord[0].id;

  const results = await db
    .selectDistinct({ locale: translations.locale })
    .from(translations)
    .where(
      and(
        eq(translations.contentTypeId, contentTypeId),
        eq(translations.entityId, entityId),
        eq(translations.isApproved, true)
      )
    );

  return results.map(r => r.locale as SupportedLocale);
}

/**
 * Helper: Translate an object's fields
 */
export async function translateObject<T extends Record<string, any>>(
  contentType: string,
  entityId: number,
  obj: T,
  fieldsToTranslate: (keyof T)[],
  locale: SupportedLocale = DEFAULT_LOCALE
): Promise<T> {
  const translated = { ...obj };

  for (const field of fieldsToTranslate) {
    const translation = await getTranslation(
      contentType,
      entityId,
      field as string,
      locale
    );

    if (translation) {
      translated[field] = translation as any;
    }
  }

  return translated;
}
