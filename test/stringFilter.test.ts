import { describe, expect, it } from 'vitest';
import { filterMessageStrings, isLikelyMessageText } from '../src/util/stringFilter';

describe('isLikelyMessageText', () => {
  it('accepts strings containing Japanese characters', () => {
    expect(isLikelyMessageText('お疲れさまでした')).toBe(true);
    expect(isLikelyMessageText('ありがとう')).toBe(true);
    expect(isLikelyMessageText('山田さんへ')).toBe(true);
    expect(isLikelyMessageText('カタカナのみ')).toBe(true);
  });

  it('accepts ASCII phrases with whitespace', () => {
    expect(isLikelyMessageText('see you tomorrow')).toBe(true);
  });

  it('rejects single-character ASCII tokens', () => {
    expect(isLikelyMessageText('a')).toBe(false);
    expect(isLikelyMessageText('')).toBe(false);
  });

  it('rejects UUIDs', () => {
    expect(isLikelyMessageText('550e8400-e29b-41d4-a716-446655440000')).toBe(false);
  });

  it('rejects MIME types', () => {
    expect(isLikelyMessageText('image/jpeg')).toBe(false);
    expect(isLikelyMessageText('application/octet-stream')).toBe(false);
  });

  it('rejects URLs', () => {
    expect(isLikelyMessageText('https://example.com/a/b')).toBe(false);
    expect(isLikelyMessageText('content://media/external/images/1')).toBe(false);
  });

  it('rejects filenames with known extensions', () => {
    expect(isLikelyMessageText('IMG_20240101.jpg')).toBe(false);
    expect(isLikelyMessageText('movie.mp4')).toBe(false);
  });

  it('rejects long hex blobs', () => {
    expect(isLikelyMessageText('deadbeefcafebabe1234567890abcdef')).toBe(false);
  });

  it('rejects upper-case constant identifiers', () => {
    expect(isLikelyMessageText('SECTION_META')).toBe(false);
    expect(isLikelyMessageText('HELLO_WORLD')).toBe(false);
  });

  it('rejects unbroken digit runs (likely timestamps/ids)', () => {
    expect(isLikelyMessageText('1700000000000')).toBe(false);
  });

  it('rejects very long strings', () => {
    expect(isLikelyMessageText('a'.repeat(600))).toBe(false);
  });

  it('passes short ASCII identifiers lacking whitespace', () => {
    expect(isLikelyMessageText('OK')).toBe(false);
  });
});

describe('filterMessageStrings', () => {
  it('keeps only likely messages in order', () => {
    const input = [
      { offset: 0, length: 4, text: 'image/jpeg' },
      { offset: 10, length: 12, text: 'お疲れさまでした' },
      { offset: 20, length: 36, text: '550e8400-e29b-41d4-a716-446655440000' },
      { offset: 60, length: 5, text: '明日よろしく' },
    ];
    const out = filterMessageStrings(input);
    expect(out.map((s) => s.text)).toEqual(['お疲れさまでした', '明日よろしく']);
  });
});
