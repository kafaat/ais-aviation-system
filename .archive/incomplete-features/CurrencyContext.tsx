import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  type ReactNode,
} from "react";
import { trpc } from "../lib/trpc";

type SupportedCurrency =
  | "SAR"
  | "USD"
  | "EUR"
  | "GBP"
  | "AED"
  | "KWD"
  | "BHD"
  | "OMR"
  | "QAR"
  | "EGP";

interface CurrencyContextType {
  currency: SupportedCurrency;
  setCurrency: (currency: SupportedCurrency) => void;
  convertFromSAR: (amountInSAR: number) => Promise<number>;
  formatCurrency: (amountInCents: number) => string;
  exchangeRate: number;
  isLoading: boolean;
}

const CurrencyContext = createContext<CurrencyContextType | undefined>(
  undefined
);

interface CurrencyProviderProps {
  children: ReactNode;
}

export function CurrencyProvider({ children }: CurrencyProviderProps) {
  // Get currency from localStorage or default to SAR
  const [currency, setCurrencyState] = useState<SupportedCurrency>(() => {
    const saved = localStorage.getItem("preferredCurrency");
    return (saved as SupportedCurrency | null) || "SAR";
  });

  const [exchangeRate, setExchangeRate] = useState<number>(1.0);
  const [isLoading, setIsLoading] = useState<boolean>(false);

  // Fetch exchange rate when currency changes
  const { data: rateData, isLoading: rateLoading } =
    trpc.currency.getExchangeRate.useQuery(
      { targetCurrency: currency },
      { enabled: currency !== "SAR" }
    );

  useEffect(() => {
    if (rateData) {
      setExchangeRate(rateData.rate);
    } else if (currency === "SAR") {
      setExchangeRate(1.0);
    }
  }, [rateData, currency]);

  useEffect(() => {
    setIsLoading(rateLoading);
  }, [rateLoading]);

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
    isLoading,
  };

  return (
    <CurrencyContext.Provider value={value}>
      {children}
    </CurrencyContext.Provider>
  );
}

export function useCurrency() {
  const context = useContext(CurrencyContext);
  if (context === undefined) {
    throw new Error("useCurrency must be used within a CurrencyProvider");
  }
  return context;
}
