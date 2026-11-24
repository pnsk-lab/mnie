import { expect, test } from 'bun:test'
import { methodGroups, toggleMethods } from '../../../mnie-ui/src/components/method-tree'

test('parent selection changes descendants while preserving other permissions', () => {
  const methods = ['admin.accounts.freeze', 'admin.accounts.update', 'admin.providers.list']
  const group = methodGroups(methods, 'admin').find((item) => item.path === 'admin.accounts')!
  expect(group.methods).toEqual(['admin.accounts.freeze', 'admin.accounts.update'])
  expect(toggleMethods(['admin.providers.list'], group.methods, true)).toEqual(methods.sort())
  expect(toggleMethods(methods, group.methods, false)).toEqual(['admin.providers.list'])
})
