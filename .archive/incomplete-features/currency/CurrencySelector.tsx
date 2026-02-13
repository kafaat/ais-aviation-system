import React from "react";
import { useCurrency } from "../CurrencyContext";
import { trpc } from "../lib/trpc";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import { Loader2 } from "lucide-react";

export function CurrencySelector() {
  const { currency, setCurrency, isLoading: currencyLoading } = useCurrency();
  const { data: currencies, isLoading } =
    trpc.currency.getSupportedCurrencies.useQuery();

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span>Loading currencies...</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <Select
        value={currency}
        onValueChange={(value) =>
          setCurrency(
            value as
              | "SAR"
              | "USD"
              | "EUR"
              | "GBP"
              | "AED"
              | "KWD"
              | "BHD"
              | "OMR"
              | "QAR"
              | "EGP"
          )
        }
      >
        <SelectTrigger className="w-[180px]">
          <SelectValue>
            {currencyLoading ? (
              <div className="flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>Loading...</span>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <span>{currencies?.find((c) => c.code === currency)?.flag}</span>
                <span>
                  {currency} - {currencies?.find((c) => c.code === currency)?.symbol}
                </span>
              </div>
            )}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {currencies?.map((curr) => (
            <SelectItem key={curr.code} value={curr.code}>
              <div className="flex items-center gap-2">
                <span>{curr.flag}</span>
                <span className="font-medium">{curr.code}</span>
                <span className="text-muted-foreground">-</span>
                <span className="text-sm text-muted-foreground">
                  {curr.name}
                </span>
                <span className="ml-auto">{curr.symbol}</span>
              </div>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

/**
 * Compact Currency Selector for mobile/header
 */
export function CompactCurrencySelector() {
  const { currency, setCurrency } = useCurrency();
  const { data: currencies } = trpc.currency.getSupportedCurrencies.useQuery();

  return (
    <Select
      value={currency}
      onValueChange={(value) =>
        setCurrency(
          value as
            | "SAR"
            | "USD"
            | "EUR"
            | "GBP"
            | "AED"
            | "KWD"
            | "BHD"
            | "OMR"
            | "QAR"
            | "EGP"
        )
      }
    >
      <SelectTrigger className="w-[100px] h-9">
        <SelectValue>
          <div className="flex items-center gap-1">
            <span className="text-xs">
              {currencies?.find((c) => c.code === currency)?.flag}
            </span>
            <span className="text-xs font-medium">{currency}</span>
          </div>
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {currencies?.map((curr) => (
          <SelectItem key={curr.code} value={curr.code}>
            <div className="flex items-center gap-2">
              <span>{curr.flag}</span>
              <span className="font-medium">{curr.code}</span>
              <span className="text-xs text-muted-foreground">
                {curr.symbol}
              </span>
            </div>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
