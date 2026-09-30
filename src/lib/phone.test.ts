import { describe, expect, it } from 'vitest';
import { normalizeIndianPhone, whatsAppLink } from './phone';

describe('normalizeIndianPhone', () => {
  it.each([
    ['+919876543210', 'with +91'],
    ['919876543210', 'with 91'],
    ['09876543210', 'with leading 0'],
    ['9876543210', 'bare 10 digits'],
    ['+91 98765 43210', 'with spaces'],
    ['  9876543210  ', 'with surrounding whitespace'],
    ['+91-98765-43210', 'with hyphens'],
    ['(+91) 98765 43210', 'with brackets'],
    ['98765.43210', 'with dots'],
  ])('accepts %s (%s)', (input) => {
    expect(normalizeIndianPhone(input)).toBe('+919876543210');
  });

  it('accepts every valid starting digit 6-9', () => {
    for (const d of ['6', '7', '8', '9']) {
      expect(normalizeIndianPhone(`${d}123456789`)).toBe(`+91${d}123456789`);
    }
  });

  it('treats a 10-digit number starting with 91 as the number, not a prefix', () => {
    expect(normalizeIndianPhone('9123456789')).toBe('+919123456789');
  });

  it.each([
    ['987654321', 'too short'],
    ['98765432101', 'too long'],
    ['+9198765432', 'too short after +91'],
    ['+91987654321012', 'too long after +91'],
  ])('rejects invalid length: %s (%s)', (input) => {
    expect(normalizeIndianPhone(input)).toBeNull();
  });

  it.each(['5876543210', '0123456789', '+911234567890', '00000000000'])(
    'rejects invalid starting digit: %s',
    (input) => {
      expect(normalizeIndianPhone(input)).toBeNull();
    },
  );

  it.each(['abcdefghij', '98765abcde', 'call me', '+1 415 555 0100', '+44 7911 123456', '0091 9876543210'])(
    'rejects letters, other countries and random input: %s',
    (input) => {
      expect(normalizeIndianPhone(input)).toBeNull();
    },
  );

  it('rejects empty and whitespace-only input', () => {
    expect(normalizeIndianPhone('')).toBeNull();
    expect(normalizeIndianPhone('   ')).toBeNull();
  });

  it('rejects null and undefined', () => {
    expect(normalizeIndianPhone(null)).toBeNull();
    expect(normalizeIndianPhone(undefined)).toBeNull();
  });
});

describe('whatsAppLink', () => {
  it('addresses the link to the normalised number without the +', () => {
    expect(whatsAppLink('Hi there', '+91 98765 43210')).toBe('https://wa.me/919876543210?text=Hi%20there');
  });

  it('falls back to an unaddressed link when there is no valid number', () => {
    expect(whatsAppLink('Hi', null)).toBe('https://wa.me/?text=Hi');
    expect(whatsAppLink('Hi', 'not a number')).toBe('https://wa.me/?text=Hi');
  });
});
