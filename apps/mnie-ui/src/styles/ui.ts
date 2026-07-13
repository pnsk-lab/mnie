export const ui = {
  appShell:
    'grid h-dvh grid-rows-[minmax(0,1fr)_auto] overflow-hidden bg-[#101418] text-[#e3e3e9] lg:grid-cols-[7rem_minmax(0,1fr)] lg:grid-rows-none',
  oauthShell: 'grid min-h-dvh overflow-x-hidden bg-[#101418] text-[#e3e3e9]',
  sidebar:
    'order-2 flex h-20 min-h-0 items-center overflow-x-auto border-t border-[#2f3338] bg-[#191c20] px-2 py-2 lg:order-none lg:h-full lg:flex-col lg:overflow-visible lg:border-t-0 lg:border-r lg:px-0 lg:py-4',
  brandMark:
    'hidden h-14 w-14 place-items-center rounded-[18px] bg-[#a8c7fa] text-3xl font-black text-[#0b305f] shadow-lg shadow-black/20 lg:grid',
  navStack:
    'flex w-full min-w-max justify-around gap-2 lg:mt-10 lg:grid lg:min-w-0 lg:gap-4 lg:px-2',
  navButton:
    'grid min-h-14 min-w-16 place-items-center gap-1 rounded-[20px] bg-transparent p-1 text-xs font-semibold text-[#c3c7cf] transition hover:bg-[#22272e] lg:min-h-16 lg:min-w-0',
  navButtonActive: 'text-[#d3e3fd]',
  navIcon: 'grid h-8 w-12 place-items-center rounded-full text-[#c3c7cf] lg:w-16',
  navIconActive: 'bg-[#263141] text-[#d3e3fd]',
  workspace:
    'order-1 flex min-h-0 min-w-0 flex-col gap-5 overflow-y-auto px-4 pt-4 pb-5 sm:px-6 sm:pt-6 lg:order-none lg:gap-7 lg:px-8 lg:pt-8 lg:pb-8',
  oauthWorkspace:
    'flex min-h-dvh min-w-0 items-start justify-center overflow-y-auto overflow-x-hidden px-4 py-5 sm:px-6 sm:py-8',
  topbar: 'flex shrink-0 flex-wrap items-center justify-between gap-4',
  tradeTopbar: 'hidden',

  authPanel: 'grid w-full min-w-0 justify-items-center',
  panel:
    'grid content-start gap-4 rounded-[28px] border border-[#30343a] bg-[#1b1f24] p-4 shadow-lg shadow-black/15 sm:p-6',
  oauthPanel: 'w-full min-w-0 max-w-[52rem]',
  loginPanel: 'w-full max-w-[28rem]',
  panelHead: 'flex flex-wrap items-center justify-between gap-3',
  eyebrow: 'mb-1 text-xs font-black uppercase text-[#9aa0a9]',
  dashboardGrid:
    'grid min-h-0 flex-1 grid-cols-1 items-stretch gap-5 lg:grid-cols-[minmax(0,1.25fr)_minmax(20rem,0.75fr)] lg:grid-rows-[max-content_minmax(20rem,auto)_auto] lg:gap-6',
  metricPanel:
    'grid min-h-36 content-center gap-3 rounded-[28px] border border-[#30343a] bg-[#1b1f24] p-5 shadow-lg shadow-black/15 sm:min-h-40 sm:p-7',
  assetOverviewPanel:
    'grid h-auto min-h-48 grid-cols-1 content-start items-stretch gap-x-7 gap-y-5 overflow-hidden rounded-[28px] border border-[#30343a] bg-[#1b1f24] p-5 shadow-lg shadow-black/15 sm:grid-cols-3 sm:p-7 lg:col-span-2',
  assetOverviewHead: 'grid gap-3',
  assetOverviewSubtext: 'text-sm font-semibold text-[#c3c7cf]',
  assetBreakdownPanel: 'grid gap-3',
  assetBreakdownTitle: 'text-xs font-extrabold text-[#9aa0a9]',
  metricLabel: 'text-xs font-extrabold text-[#9aa0a9]',
  metricValue: 'break-words text-2xl font-black sm:text-3xl',
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
    'flex min-h-80 flex-col gap-4 rounded-[28px] border border-[#30343a] bg-[#1b1f24] p-5 shadow-lg shadow-black/15 sm:p-7',
  holdingsBody: 'flex min-h-0 flex-1 flex-col overflow-visible lg:overflow-hidden',
  holdingsRows: 'grid min-h-0 flex-1 content-start overflow-y-auto',
  holdingsHead:
    'hidden grid-cols-[1.6fr_0.7fr_0.6fr_0.9fr_0.9fr_auto] items-center gap-4 border-b border-[#33383f] py-3 text-xs font-extrabold text-[#8f949d] md:grid',
  holdingRow:
    'grid min-h-16 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-2xl bg-[#111418] px-3 py-3 text-left text-[#e3e3e9] transition hover:bg-[#242930] md:grid-cols-[1.6fr_0.7fr_0.6fr_0.9fr_0.9fr_auto] md:gap-4 md:bg-transparent',
  typePill: 'w-fit rounded-full bg-[#263141] px-3 py-1 text-xs text-[#d3e3fd]',
  muted: 'text-[#8f949d]',
  portfolioHistory:
    'flex min-h-80 flex-col gap-4 rounded-[28px] border border-[#30343a] bg-[#1b1f24] p-5 shadow-lg shadow-black/15 sm:p-7',
  historyList: 'flex min-h-0 flex-1 flex-col overflow-visible lg:overflow-hidden',
  historyRows: 'grid min-h-0 flex-1 content-start gap-5 overflow-y-auto lg:gap-7',
  marketIndexPanel:
    'grid gap-4 rounded-[28px] border border-[#30343a] bg-[#1b1f24] p-5 shadow-lg shadow-black/15 sm:p-7 lg:col-span-2',
  marketIndexGrid: 'grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4',
  marketIndexCard: 'grid min-h-28 content-center gap-2 rounded-2xl bg-[#111418] p-4',
  marketIndexValue: 'break-words text-xl font-black text-[#e3e3e9]',
  emptyState: 'flex flex-1 items-center justify-center py-8 text-center',
  miniOrder: 'grid grid-cols-[minmax(0,1fr)_auto] gap-3',
  tradeLayout:
    'trade-layout grid w-full min-w-0 grid-cols-1 items-stretch gap-5 lg:min-h-[calc(100dvh-6rem)] lg:grid-cols-5',
  watchlist:
    'order-3 grid min-w-0 content-start gap-2 overflow-visible border-t border-[#30343a] bg-[#101418] pt-4 shadow-none lg:col-span-1 lg:h-full lg:min-h-[calc(100dvh-6rem)] lg:overflow-y-auto lg:border-t-0 lg:border-l lg:pt-0 lg:pl-2',
  watchSearch:
    'm-3 inline-flex min-h-11 items-center gap-2 rounded-full bg-[#111418] px-4 text-left font-medium text-[#9aa0a9] outline outline-1 outline-[#33383f] transition hover:bg-[#22272e] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#d3e3fd]',
  watchRow:
    'grid min-h-18 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-lg border-l-2 border-transparent px-4 py-3 text-left text-[#e3e3e9] transition hover:bg-[#242930] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[#d3e3fd]',
  watchRowActive: 'bg-gray-900',
  centerStack: 'order-1 col-span-3 flex min-h-0 h-full flex-col gap-5',
  stockMetadataPanel:
    'grid min-h-0 gap-4 rounded-[24px] border-0 bg-[#101418] p-0 shadow-none sm:p-6',
  stockBodyGrid: 'grid min-h-0 flex-1 gap-5 lg:grid-rows-3',
  tradeSeparator: 'order-3 hidden',
  stockPanel:
    'grid min-h-0 h-full grid-rows-[auto_auto_1fr] gap-4 rounded-[24px] border-0 bg-[#101418] p-0 shadow-none sm:p-6',
  stockPanelSpan: 'lg:row-span-2',
  stockTitle: 'flex flex-wrap items-start justify-between gap-3',
  stockHoldingNote:
    'inline-flex w-fit items-center rounded-full border border-[#2f343b] bg-[#111418] px-4 py-2 text-sm font-semibold text-[#c3c7cf]',
  quoteBox: 'grid justify-items-start gap-1 sm:justify-items-end',
  periodTabs: 'flex flex-wrap justify-start gap-2 sm:justify-end',
  periodButton: 'min-h-7 rounded-full bg-transparent px-3 text-xs font-bold text-[#8f949d]',
  periodButtonActive: 'bg-[#d3e3fd] text-[#102033]',
  chartActions: 'flex flex-wrap items-center justify-between gap-4',
  smallTabs: 'grid grid-cols-2 gap-1 rounded-full bg-[#111418] p-1',
  smallTab: 'min-h-8 rounded-full bg-transparent px-3 text-xs font-bold text-[#9aa0a9]',
  smallTabActive: 'bg-[#263141] text-[#d3e3fd]',
  chartBox:
    'mt-1 h-72 min-h-0 overflow-hidden rounded-[20px] bg-[#111418] lg:h-full lg:min-h-[14rem]',
  chartLine: 'fill-none stroke-[#40dba2] stroke-[3]',
  boxplot: 'grid min-h-36 content-center gap-5 rounded-[24px] bg-[#111418] p-7',
  boxplotScale: 'flex justify-between text-xs text-[#8f949d]',
  boxplotTrack:
    'relative h-20 before:absolute before:inset-x-0 before:top-10 before:h-0.5 before:bg-[#4a5058]',
  whisker: 'absolute top-9 h-3 border-x-2 border-[#c3c7cf]',
  box: 'absolute top-6 h-9 rounded-xl border-2 border-[#a8c7fa] bg-[#a8c7fa]/25',
  median: 'absolute top-4 h-12 border-l-4 border-[#fdd663]',
  infoTabPanel: 'grid gap-0 rounded-[24px] border-0 bg-[#101418] p-0 shadow-none sm:p-6',
  infoTabList: 'flex gap-6 border-b border-[#33383f]',
  infoTabButton:
    'relative min-h-10 px-1 text-sm font-black text-[#8f949d] transition hover:text-[#d3e3fd] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#d3e3fd]',
  infoTabButtonActive: 'text-[#d3e3fd]',
  infoTabIndicator: 'absolute inset-x-0 bottom-[-1px] block h-0.5 rounded-full bg-[#d3e3fd]',
  infoTabBody: 'overflow-hidden pt-4',
  infoTabBodyInner: 'relative min-h-[9.5rem]',
  detailGrid: 'grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3',
  detailItem: 'grid min-h-16 gap-1 rounded-[14px] bg-[#111418] p-3',
  holdingEmpty:
    'rounded-[16px] border border-[#2f343b] bg-[#111418] px-4 py-3 text-sm font-semibold text-[#8f949d]',
  ticketPanel:
    'order-2 col-span-1 flex h-full min-h-0 flex-col gap-4 overflow-visible border-0 bg-[#101418] p-0 shadow-none sm:p-6 lg:overflow-hidden',
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
  accountTypeGrid: 'grid grid-cols-2 gap-2',
  accountTypeButton:
    'relative isolate grid min-h-11 place-items-center overflow-hidden rounded-[14px] bg-[#111418] px-2 py-2 text-center text-xs font-extrabold leading-snug text-[#9aa0a9] transition hover:bg-[#1d232b] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#d3e3fd]',
  accountTypeButtonActive: 'text-[#d3e3fd]',
  accountTypeIndicator: 'absolute inset-0 -z-10 rounded-[14px] bg-[#263141]',
  accountTypeText: 'relative block whitespace-normal break-keep leading-snug',
  label: 'grid gap-2 text-xs font-extrabold text-[#9aa0a9]',
  input:
    'min-h-12 w-full rounded-[16px] border border-[#4a5058] bg-[#111418] px-4 text-[#e3e3e9] outline-none transition placeholder:text-[#747982] focus:border-[#a8c7fa]',
  estimateSummary:
    'flex flex-wrap items-center justify-between gap-2 rounded-[18px] border border-[#2f343b] bg-[#111418] px-5 py-4',
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
    'grid grid-cols-2 items-center gap-3 rounded-[20px] bg-[#111418] p-4 md:grid-cols-[minmax(180px,1fr)_auto_auto_auto_auto_minmax(12rem,auto)]',
  statusBadge: 'w-fit rounded-full bg-[#263141] px-3 py-1 text-xs font-black text-[#d3e3fd]',
  pendingBadge: 'bg-[#4a3720] text-[#ffddb3]',
  apiLayout: 'grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,0.9fr)] lg:gap-7',
  settingsLayout: 'grid gap-7',
  row: 'grid grid-cols-1 items-center gap-3 rounded-[20px] bg-[#111418] p-4 sm:grid-cols-[minmax(0,1fr)_auto]',
  rowActions: 'flex flex-wrap items-center justify-end gap-2',
  keyRow: 'grid gap-3 rounded-[24px] bg-[#111418] p-4',
  profileRow:
    'grid grid-cols-[auto_minmax(0,1fr)] items-center gap-3 rounded-[20px] bg-[#111418] p-4 sm:grid-cols-[auto_minmax(0,1fr)_auto]',
  searchOverlay: 'fixed inset-0 z-20 bg-[#101418]/75 backdrop-blur-sm',
  searchSheet:
    'mx-auto mt-2 grid max-h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] max-w-[48rem] gap-3 overflow-auto rounded-[28px] border border-[#30343a] bg-[#1b1f24]/85 p-3 shadow-2xl shadow-black/35 sm:mt-4 sm:max-h-[85vh] sm:w-[calc(100vw-2rem)] sm:p-4 md:w-[48rem]',
  searchInputRow: 'grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_auto]',
  filterRow: 'grid grid-cols-1 gap-3 sm:grid-cols-2',
  searchResults: 'grid gap-2',
  searchLoading: 'flex min-h-32 flex-col items-center justify-center gap-3 py-8 text-[#9aa0a8]',
  searchResult:
    'flex min-h-16 flex-wrap items-center justify-between gap-4 rounded-[20px] border border-transparent bg-[#111418] p-4 text-left text-[#e3e3e9] transition hover:bg-[#242930] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#d3e3fd]',
  searchResultActive: 'border-l-4 border-[#d3e3fd] bg-[#242930]',
  searchResultFocus:
    'bg-[#2a323a] outline outline-2 outline-[#d3e3fd] outline-offset-[-2px] shadow-[0_0_0_1px_rgba(211,227,253,0.35)]',
  confirmList: 'grid gap-2',
  confirmRow: 'flex justify-between gap-3 border-b border-[#33383f] pb-2',
  dialogNote: 'leading-7 text-[#c3c7cf]',
} as const
