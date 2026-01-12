import React, { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { trpc } from "../lib/trpc";

type SupportedCurrency = "SAR" | "USD" | "EUR" | "GBP" | "AED" | "KWD" | "BHD" | "OMR" | "QAR" | "EGP";

interface CurrencyContextType {
  currency: SupportedCurrency;
  setCurrency: (currency: SupportedCurrency) => void;
  convertFromSAR: (amountInSAR: number) => Promise<number>;
  formatCurrency: (amountInCents: number) => string;
  exchangeRate: number;
  isLoading: boolean;
}

const CurrencyContext = createContext<CurrencyContextType | undefined>(undefined);

interface CurrencyProviderProps {
  children: ReactNode;
}

export function CurrencyProvider({ children }: CurrencyProviderProps) {
  // Get currency from localStorage or default to SAR
  const [currency, setCurrencyState] = useState<SupportedCurrency>(() => {
    const saved = localStorage.getItem("preferredCurrency");
    return (saved as SupportedCurrency) || "SAR";
  });

  const [exchangeRate, setExchangeRate] = useState<number>(1.0);

  // Fetch all exchange rates
  const { data: exchangeRates } = trpc.currency.getAllExchangeRates.useQuery();

  useEffect(() => {
    if (exchangeRates && currency !== "SAR") {
      const rate = exchangeRates.find((r: any) => r.targetCurrency === currency);
      if (rate) {
        setExchangeRate(Number(rate.rate));
      }
    } else if (currency === "SAR") {
      setExchangeRate(1.0);
    }
  }, [exchangeRates, currency]);

  const setCurrency = (newCurrency: SupportedCurrency) => {
    setCurrencyState(newCurrency);
    localStorage.setItem("preferredCurrency", newCurrency);
  };

  const convertFromSAR = async (amountInSAR: number): Promise<number> => {
    if (currency === "SAR") return amountInSAR;
    return Math.round(amountInSAR * exchangeRate);
  };

  const formatCurrency = (amountInCents: number): string => {
    const currencySymbols: Record<SupportedCurrency, string> = {
      SAR: "﷼",
      USD: "$",
      EUR: "€",
      GBP: "£",
      AED: "د.إ",
      KWD: "د.ك",
      BHD: "د.ب",
      OMR: "ر.ع.",
      QAR: "ر.ق",
      EGP: "ج.م",
    };

    const amount = amountInCents / 100;
    const formatted = amount.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });

    return `${currencySymbols[currency]} ${formatted}`;
  };

  const value: CurrencyContextType = {
    currency,
    setCurrency,
    convertFromSAR,
    formatCurrency,
    exchangeRate,
    isLoading: false,
  };

  return <CurrencyContext.Provider value={value}>{children}</CurrencyContext.Provider>;
}

export function useCurrency() {
  const context = useContext(CurrencyContext);
  if (context === undefined) {
    throw new Error("useCurrency must be used within a CurrencyProvider");
  }
  return context;
}
