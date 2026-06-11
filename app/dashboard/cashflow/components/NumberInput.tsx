'use client';

import { useState, useEffect } from 'react';

interface NumberInputProps {
  value: number;
  onChange: (value: number) => void;
  step?: string;
  placeholder?: string;
  className?: string;
  decimals?: number;
  multiplier?: number;
  showFormatted?: boolean; // Pour afficher avec séparateurss
}

function formatNumber(value: number, decimals: number): string {
  return value.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  });
}

function parseFormattedNumber(value: string): number {
  const cleaned = value.replace(/,/g, '');
  return parseFloat(cleaned) || 0;
}

export function NumberInput({ 
  value, 
  onChange, 
  step = "0.1", 
  placeholder, 
  className = "",
  decimals = 2,
  multiplier = 1,
  showFormatted = true
}: NumberInputProps) {
  const [localValue, setLocalValue] = useState<string>('');
  const [isFocused, setIsFocused] = useState(false);

  useEffect(() => {
    if (!isFocused) {
      if (value === 0) {
        setLocalValue('');
      } else {
        const displayValue = value / multiplier;
        if (showFormatted && !isFocused) {
          setLocalValue(formatNumber(displayValue, decimals));
        } else {
          setLocalValue(displayValue.toString());
        }
      }
    }
  }, [value, isFocused, multiplier, decimals, showFormatted]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    // Permettre seulement les chiffres, points, virgules et tirets
    if (/^[-0-9.,]*$/.test(newValue)) {
      setLocalValue(newValue);
    }
  };

  const handleBlur = () => {
    setIsFocused(false);
    const numValue = parseFormattedNumber(localValue);
    if (!isNaN(numValue) && numValue !== 0) {
      onChange(numValue * multiplier);
      // Reformatter avec virgules
      if (showFormatted) {
        setLocalValue(formatNumber(numValue, decimals));
      }
    } else if (localValue === '' || localValue === '-' || numValue === 0) {
      onChange(0);
      setLocalValue('');
    }
  };

  const handleFocus = (e: React.FocusEvent<HTMLInputElement>) => {
    setIsFocused(true);
    // Enlever les virgules pour faciliter l'édition
    if (localValue) {
      const cleaned = localValue.replace(/,/g, '');
      setLocalValue(cleaned);
    }
    e.target.select();
  };

  return (
    <input
      type="text"
      inputMode="decimal"
      value={localValue}
      onChange={handleChange}
      onFocus={handleFocus}
      onBlur={handleBlur}
      placeholder={placeholder}
      className={className}
    />
  );
}