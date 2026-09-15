import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/_core/hooks/useAuth";
import { Redirect } from "wouter";
import { Button } from "@/components/ui/button";
export function useOperationalLabels() {
  const { i18n } = useTranslation();
  return (ar: string, en: string) => (i18n.language.startsWith("ar") ? ar : en);
}
export function AdminConsole({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  const { user, loading } = useAuth();
  const l = useOperationalLabels();
  if (loading) return <p role="status">{l("جارٍ التحميل", "Loading")}</p>;
  if (!user || !["admin", "super_admin"].includes(user.role))
    return <Redirect to="/" />;
  return (
    <main className="container py-8 space-y-6">
      <h1 className="text-2xl font-bold">{title}</h1>
      {children}
    </main>
  );
}
export function OperationalReadState({
  query,
  children,
}: {
  query: {
    isLoading: boolean;
    error?: { message: string } | null;
    data?: unknown;
    refetch: () => unknown;
  };
  children: ReactNode;
}) {
  const l = useOperationalLabels();
  if (query.error)
    return (
      <div role="alert">
        {l("المصدر غير متاح", "Source unavailable")}: {query.error.message}{" "}
        <Button
          onClick={() => {
            void query.refetch();
          }}
        >
          {l("إعادة المحاولة", "Retry")}
        </Button>
      </div>
    );
  if (query.isLoading)
    return <p role="status">{l("جارٍ التحميل", "Loading")}</p>;
  if (query.data === undefined)
    return (
      <p>{l("اختر المصدر لعرض البيانات", "Choose a source to view data")}</p>
    );
  return <>{children}</>;
}
