export const ui = {
  appShell: 'grid h-dvh overflow-hidden grid-cols-[7rem_minmax(0,1fr)] bg-[#101418] text-[#e3e3e9]',
  sidebar: 'flex h-full min-h-0 flex-col items-center border-r border-[#2f3338] bg-[#191c20] py-4',
  brandMark:
    'grid h-14 w-14 place-items-center rounded-[18px] bg-[#a8c7fa] text-3xl font-black text-[#0b305f] shadow-lg shadow-black/20',
  navStack: 'mt-10 grid w-full gap-4 px-2',
  navButton:
    'grid min-h-16 place-items-center gap-1 rounded-[20px] bg-transparent p-1 text-xs font-semibold text-[#c3c7cf] transition hover:bg-[#22272e]',
  navButtonActive: 'text-[#d3e3fd]',
  navIcon: 'grid h-8 w-16 place-items-center rounded-full text-[#c3c7cf]',
  navIconActive: 'bg-[#263141] text-[#d3e3fd]',
  workspace: 'flex min-h-0 min-w-0 flex-col gap-7 overflow-y-auto px-8 pt-8 pb-8',
  topbar: 'flex shrink-0 items-center justify-between gap-4',
  tradeTopbar: 'hidden',

  authPanel: 'grid justify-center pt-12',
  panel:
    'grid content-start gap-4 rounded-[28px] border border-[#30343a] bg-[#1b1f24] p-6 shadow-lg shadow-black/15',
  loginPanel: 'w-[28rem]',
  panelHead: 'flex items-center justify-between gap-3',
  eyebrow: 'mb-1 text-xs font-black uppercase text-[#9aa0a9]',
  dashboardGrid:
    'grid min-h-0 flex-1 grid-cols-[minmax(0,1.25fr)_minmax(20rem,0.75fr)] grid-rows-[auto_minmax(0,1fr)] items-stretch gap-6 overflow-hidden',
  metricPanel:
    'grid min-h-40 content-center gap-3 rounded-[28px] border border-[#30343a] bg-[#1b1f24] p-7 shadow-lg shadow-black/15',
  assetOverviewPanel:
    'grid min-h-40 grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] items-center gap-x-7 gap-y-4 rounded-[28px] border border-[#30343a] bg-[#1b1f24] p-7 shadow-lg shadow-black/15',
  assetOverviewHead: 'grid gap-2',
  assetOverviewSubtext: 'text-sm font-semibold text-[#c3c7cf]',
  assetBreakdownPanel: 'grid gap-3',
  assetBreakdownTitle: 'text-xs font-extrabold text-[#9aa0a9]',
  metricLabel: 'text-xs font-extrabold text-[#9aa0a9]',
  metricValue: 'text-3xl font-black',
  positive: 'text-[#40dba2]',
  negative: 'text-[#ffb4ab]',
  miniProgress: 'block h-2 w-full overflow-hidden rounded-full bg-[#33383f]',
  miniProgressBar: 'block h-full w-[12%] rounded-full bg-[#a8c7fa]',
  assetBreakdownBar: 'flex h-3 w-full overflow-hidden rounded-full bg-[#33383f]',
  assetBreakdownStocks: 'block h-full bg-[#a8c7fa]',
  assetBreakdownCash: 'block h-full bg-[#40dba2]',
  assetBreakdownRows: 'grid gap-2',
  assetBreakdownRow: 'flex items-center justify-between gap-4',
  assetBreakdownLabel: 'inline-flex items-center gap-2 text-sm font-semibold text-[#c3c7cf]',
  assetBreakdownSwatch: 'block h-2.5 w-2.5 shrink-0 rounded-full',
  assetBreakdownSwatchStocks: 'bg-[#a8c7fa]',
  assetBreakdownSwatchCash: 'bg-[#40dba2]',
  assetBreakdownMeta: 'grid justify-items-end gap-0.5 text-right',
  assetBreakdownAmount: 'text-sm font-black text-[#e3e3e9]',
  assetBreakdownRatio: 'text-xs font-semibold text-[#8f949d]',
  holdingsPanel:
    'flex min-h-0 flex-col gap-4 rounded-[28px] border border-[#30343a] bg-[#1b1f24] p-7 shadow-lg shadow-black/15',
  holdingsBody: 'flex min-h-0 flex-1 flex-col overflow-hidden',
  holdingsRows: 'grid min-h-0 flex-1 content-start overflow-y-auto',
  holdingsHead:
    'grid grid-cols-[1.7fr_0.8fr_0.7fr_1fr_1fr] items-center gap-4 border-b border-[#33383f] py-3 text-xs font-extrabold text-[#8f949d]',
  holdingRow:
    'grid min-h-16 grid-cols-[1.7fr_0.8fr_0.7fr_1fr_1fr] items-center gap-4 rounded-2xl bg-transparent px-3 py-3 text-left text-[#e3e3e9] transition hover:bg-[#242930]',
  typePill: 'w-fit rounded-full bg-[#263141] px-3 py-1 text-xs text-[#d3e3fd]',
  muted: 'text-[#8f949d]',
  portfolioHistory:
    'flex min-h-0 flex-col gap-4 rounded-[28px] border border-[#30343a] bg-[#1b1f24] p-7 shadow-lg shadow-black/15',
  historyList: 'flex min-h-0 flex-1 flex-col overflow-hidden',
  historyRows: 'grid min-h-0 flex-1 content-start gap-7 overflow-y-auto',
  emptyState: 'flex flex-1 items-center justify-center py-8 text-center',
  miniOrder: 'grid grid-cols-[minmax(0,1fr)_auto] gap-3',
  tradeLayout: 'trade-layout grid w-full min-h-[calc(100dvh-6rem)] grid-cols-5 items-stretch gap-5',
  watchlist:
    'order-3 pl-2 col-span-1 grid h-full min-h-[calc(100dvh-6rem)] content-start overflow-y-auto border-l border-[#30343a] bg-[#101418] shadow-none',
  watchSearch:
    'm-3 inline-flex min-h-11 items-center gap-2 rounded-full bg-[#111418] px-4 text-left font-medium text-[#9aa0a9] outline outline-1 outline-[#33383f] transition hover:bg-[#22272e] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#d3e3fd]',
  watchRow:
    'grid min-h-18 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-l-2 border-transparent bg-transparent px-4 py-3 text-left text-[#e3e3e9] transition hover:bg-[#242930] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[#d3e3fd]',
  watchRowActive: 'border-[#c3c7cf] bg-[#242930]',
  centerStack: 'order-1 col-span-3 grid content-start gap-5',
  tradeSeparator: 'order-3 hidden',
  stockPanel:
    'grid min-h-72 content-start gap-4 rounded-[24px] border-0 bg-[#101418] p-6 shadow-none',
  stockTitle: 'flex items-start justify-between gap-3',
  stockHoldingNote:
    'inline-flex w-fit items-center rounded-full border border-[#2f343b] bg-[#111418] px-4 py-2 text-sm font-semibold text-[#c3c7cf]',
  quoteBox: 'grid justify-items-end gap-1',
  periodTabs: 'flex justify-end gap-3',
  periodButton: 'min-h-7 rounded-full bg-transparent px-3 text-xs font-bold text-[#8f949d]',
  periodButtonActive: 'bg-[#d3e3fd] text-[#102033]',
  chartActions: 'flex items-center justify-between gap-4',
  smallTabs: 'grid grid-cols-2 gap-1 rounded-full bg-[#111418] p-1',
  smallTab: 'min-h-8 rounded-full bg-transparent px-3 text-xs font-bold text-[#9aa0a9]',
  smallTabActive: 'bg-[#263141] text-[#d3e3fd]',
  chartBox: 'mt-1 h-40 overflow-hidden rounded-[20px] bg-[#111418]',
  chartLine: 'fill-none stroke-[#40dba2] stroke-[3]',
  boxplot: 'grid min-h-36 content-center gap-5 rounded-[24px] bg-[#111418] p-7',
  boxplotScale: 'flex justify-between text-xs text-[#8f949d]',
  boxplotTrack:
    'relative h-20 before:absolute before:inset-x-0 before:top-10 before:h-0.5 before:bg-[#4a5058]',
  whisker: 'absolute top-9 h-3 border-x-2 border-[#c3c7cf]',
  box: 'absolute top-6 h-9 rounded-xl border-2 border-[#a8c7fa] bg-[#a8c7fa]/25',
  median: 'absolute top-4 h-12 border-l-4 border-[#fdd663]',
  infoTabPanel: 'grid gap-0 rounded-[24px] border-0 bg-[#101418] p-6 shadow-none',
  infoTabList: 'flex gap-6 border-b border-[#33383f]',
  infoTabButton:
    'relative min-h-10 px-1 text-sm font-black text-[#8f949d] transition hover:text-[#d3e3fd] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#d3e3fd]',
  infoTabButtonActive: 'text-[#d3e3fd]',
  infoTabIndicator: 'absolute inset-x-0 bottom-[-1px] block h-0.5 rounded-full bg-[#d3e3fd]',
  infoTabBody: 'overflow-hidden pt-4',
  detailGrid: 'grid grid-cols-3 gap-3',
  detailItem: 'grid min-h-16 gap-1 rounded-[14px] bg-[#111418] p-3',
  holdingEmpty:
    'rounded-[16px] border border-[#2f343b] bg-[#111418] px-4 py-3 text-sm font-semibold text-[#8f949d]',
  ticketPanel:
    'order-2 col-span-1 flex h-full min-h-0 flex-col gap-4 overflow-hidden border-0 bg-[#101418] p-6 shadow-none',
  ticketTop: 'shrink-0',
  ticketScroll: 'min-h-0 flex-1 overflow-y-auto pr-1',
  ticketScrollInner: 'grid content-start gap-3',
  ticketBottom: 'grid shrink-0 gap-3',
  ticketBox: 'grid grid-cols-1 gap-3',
  advancedOptions: 'group bg-transparent p-0',
  advancedSummary:
    'flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 rounded-[16px] bg-[#111418] px-4 text-sm font-extrabold text-[#d3e3fd] transition hover:bg-[#182029] marker:hidden [&::-webkit-details-marker]:hidden',
  advancedSummaryIconWrap: 'grid h-4 w-4 place-items-center',
  advancedSummaryIcon: 'h-4 w-4',
  advancedBody: 'grid gap-2 pt-3',
  advancedLabel: 'text-xs font-extrabold text-[#9aa0a9]',
  label: 'grid gap-2 text-xs font-extrabold text-[#9aa0a9]',
  input:
    'min-h-12 w-full rounded-[16px] border border-[#4a5058] bg-[#111418] px-4 text-[#e3e3e9] outline-none transition placeholder:text-[#747982] focus:border-[#a8c7fa]',
  estimateSummary:
    'flex items-center justify-between rounded-[18px] border border-[#2f343b] bg-[#111418] px-5 py-4',
  holdingNote:
    'rounded-[16px] border border-[#2f343b] bg-[#111418] px-4 py-3 text-sm font-semibold text-[#c3c7cf]',
  actions: 'grid gap-3',
  primaryButton:
    'inline-flex min-h-10 items-center justify-center gap-2 rounded-full bg-[#a8c7fa] px-5 font-extrabold text-[#102033] shadow-sm shadow-black/20 transition hover:bg-[#d3e3fd] disabled:opacity-50',
  dangerButton:
    'inline-flex min-h-10 items-center justify-center gap-2 rounded-full bg-[#ffb4ab] px-5 font-extrabold text-[#690005] shadow-sm shadow-black/20 transition hover:bg-[#ffd8d3] disabled:opacity-50',
  ghostButton:
    'inline-flex min-h-10 items-center justify-center gap-2 rounded-full border border-[#4a5058] bg-transparent px-5 font-extrabold text-[#d3e3fd] transition hover:bg-[#263141]',
  list: 'grid gap-2',
  orderRow:
    'grid grid-cols-[minmax(180px,1fr)_auto_auto_auto_auto_auto] items-center gap-3 rounded-[20px] bg-[#111418] p-4',
  statusBadge: 'w-fit rounded-full bg-[#263141] px-3 py-1 text-xs font-black text-[#d3e3fd]',
  pendingBadge: 'bg-[#4a3720] text-[#ffddb3]',
  apiLayout: 'grid grid-cols-[minmax(0,1fr)_minmax(20rem,0.9fr)] gap-7',
  settingsLayout: 'grid gap-7',
  row: 'grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-[20px] bg-[#111418] p-4',
  rowActions: 'flex gap-2',
  keyRow: 'grid gap-3 rounded-[24px] bg-[#111418] p-4',
  profileRow:
    'grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-[20px] bg-[#111418] p-4',
  searchOverlay: 'fixed inset-0 z-20 bg-[#101418]/75 backdrop-blur-sm',
  searchSheet:
    'mx-auto mt-4 grid max-h-[85vh] w-[48rem] gap-3 overflow-auto rounded-[28px] border border-[#30343a] bg-[#1b1f24]/85 p-4 shadow-2xl shadow-black/35',
  searchInputRow: 'grid grid-cols-[minmax(0,1fr)_auto] gap-3',
  filterRow: 'grid grid-cols-2 gap-3',
  searchResults: 'grid gap-2',
  searchLoading: 'flex min-h-32 flex-col items-center justify-center gap-3 py-8 text-[#9aa0a8]',
  searchResult:
    'flex min-h-16 items-center justify-between gap-4 rounded-[20px] border border-transparent bg-[#111418] p-4 text-left text-[#e3e3e9] transition hover:bg-[#242930] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#d3e3fd]',
  searchResultActive: 'border-[#5f666f] bg-[#242930]',
  confirmList: 'grid gap-2',
  confirmRow: 'flex justify-between gap-3 border-b border-[#33383f] pb-2',
  dialogNote: 'leading-7 text-[#c3c7cf]',
} as const
