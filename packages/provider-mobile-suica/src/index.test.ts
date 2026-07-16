import { describe, expect, test } from 'vite-plus/test'
import { isMobileSuicaCardCharge } from './index'

describe('Mobile Suica history classification', () => {
  test.each([
    ['ｶｰﾄﾞ', 'ﾓﾊﾞｲﾙ'],
    ['ｶｰﾄﾞ', 'モバイル'],
    ['カード', 'ﾓﾊﾞｲﾙ'],
    ['カード', 'モバイル'],
  ])('recognizes card charge labels %s / %s', (typeFrom, placeFrom) => {
    expect(isMobileSuicaCardCharge(typeFrom, placeFrom)).toBe(true)
  })
})
