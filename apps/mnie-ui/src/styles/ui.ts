export const ui = {
  appShell:
    'grid h-dvh grid-rows-[minmax(0,1fr)_auto] overflow-hidden bg-canvas text-fg lg:grid-cols-[7rem_minmax(0,1fr)] lg:grid-rows-none',
  oauthShell: 'grid min-h-dvh overflow-x-hidden bg-canvas text-fg',
  sidebar:
    'order-2 flex h-20 min-h-0 items-center overflow-x-auto border-t border-border bg-raised px-2 py-2 lg:order-none lg:h-full lg:flex-col lg:overflow-visible lg:border-t-0 lg:border-r lg:px-0 lg:py-4',
  brandMark:
    'hidden h-14 w-14 place-items-center rounded-2xl bg-primary text-3xl font-black text-on-primary lg:grid',
  navStack:
    'flex w-full min-w-max justify-around gap-2 lg:mt-10 lg:grid lg:min-w-0 lg:gap-4 lg:px-2',
  navButton:
    'grid min-h-14 min-w-16 place-items-center gap-1 rounded-[20px] bg-transparent p-1 text-xs font-semibold text-fg-secondary transition hover:bg-hover lg:min-h-16 lg:min-w-0',
  navButtonActive: 'text-primary-soft',
  navIcon: 'relative grid h-8 w-12 place-items-center rounded-full text-fg-secondary lg:w-16',
  navIconActive: 'text-primary-soft',
  navIconIndicator: 'pointer-events-none absolute inset-0 rounded-full bg-primary-container',
  themeToggle:
    'grid min-h-12 min-w-12 place-items-center rounded-full text-fg-secondary transition hover:bg-hover hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-soft lg:min-h-14 lg:min-w-0',
  workspace:
    'order-1 flex min-h-0 min-w-0 flex-col gap-5 overflow-y-auto px-4 pt-4 pb-5 sm:px-6 sm:pt-6 lg:order-none lg:gap-7 lg:px-8 lg:pt-8 lg:pb-8',
  oauthWorkspace:
    'flex min-h-dvh min-w-0 items-start justify-center overflow-y-auto overflow-x-hidden px-4 py-5 sm:px-6 sm:py-8',
  topbar: 'flex shrink-0 flex-wrap items-center justify-between gap-4',
  tradeTopbar: 'hidden',

  authPanel: 'grid w-full min-w-0 justify-items-center',
  panel: 'grid content-start gap-4 rounded-3xl border border-border bg-transparent p-4 sm:p-6',
  oauthPanel: 'w-full min-w-0 max-w-[52rem]',
  loginPanel: 'w-full max-w-[28rem]',
  panelHead: 'flex flex-wrap items-center justify-between gap-3',
  eyebrow: 'mb-1 text-xs font-black uppercase text-fg-muted',
  dashboardGrid: 'grid w-full min-w-0 flex-none grid-cols-1 content-start gap-0',
  metricPanel:
    'grid min-h-36 content-center gap-3 border-0 bg-canvas p-5 shadow-none sm:min-h-40 sm:p-7',
  assetOverviewPanel:
    'grid h-auto min-h-48 grid-cols-1 items-stretch gap-x-7 gap-y-5 border-0 bg-canvas px-5 py-5 shadow-none sm:grid-cols-3 sm:px-7 sm:py-7',
  assetOverviewHead: 'grid gap-3',
  assetOverviewSubtext: 'text-sm font-semibold text-fg-secondary',
  assetBreakdownPanel: 'grid min-w-0 gap-3 overflow-hidden',
  assetBreakdownTitle: 'text-xs font-extrabold text-fg-muted',
  metricLabel: 'text-xs font-extrabold text-fg-muted',
  metricValue: 'break-words text-2xl font-black sm:text-3xl',
  positive: 'text-positive',
  negative: 'text-negative',
  miniProgress: 'block h-2 w-full overflow-hidden rounded-full bg-border-subtle',
  miniProgressBar: 'block h-full w-[12%] rounded-full bg-primary',
  assetBreakdownBar: 'flex h-3 w-full overflow-hidden rounded-full bg-border-subtle',
  assetBreakdownStocks: 'block h-full bg-primary',
  assetBreakdownCash: 'block h-full bg-positive',
  assetBreakdownRows: 'grid gap-2',
  assetBreakdownRow: 'flex items-center justify-between gap-4',
  assetBreakdownLabel: 'inline-flex items-center gap-2 text-sm font-semibold text-fg-secondary',
  assetBreakdownSwatch: 'block h-2.5 w-2.5 shrink-0 rounded-full',
  assetBreakdownSwatchStocks: 'bg-primary',
  assetBreakdownSwatchCash: 'bg-positive',
  assetBreakdownMeta: 'grid justify-items-end gap-0.5 text-right',
  assetBreakdownAmount: 'text-sm font-black text-fg',
  assetBreakdownRatio: 'text-xs font-semibold text-fg-faint',
  dashboardRule: 'mx-0 my-8 h-px w-full shrink-0 border-0 bg-border-strong sm:my-10',
  dashboardMidRow:
    'grid min-h-80 grid-cols-1 lg:h-[22rem] lg:grid-cols-[minmax(0,1.25fr)_auto_minmax(20rem,0.75fr)] lg:min-h-0',
  dashboardMidDivider: 'hidden self-stretch px-3 py-6 lg:flex lg:items-stretch lg:justify-center',
  dashboardMidDividerLine: 'w-px flex-1 bg-border-strong',
  holdingsPanel:
    'flex min-h-0 max-h-[22rem] flex-col gap-4 border-0 bg-canvas px-5 shadow-none sm:px-7 lg:h-full lg:max-h-none lg:pr-8',
  holdingsBody: 'flex min-h-0 flex-1 flex-col overflow-hidden',
  holdingsRows: 'grid min-h-0 flex-1 content-start overflow-y-auto',
  holdingsHead:
    'hidden shrink-0 grid-cols-[1fr_1.6fr_0.7fr_0.6fr_0.9fr_0.9fr_auto] items-center gap-4 border-b border-border-strong py-3 text-xs font-extrabold text-fg-muted md:grid',
  holdingRow:
    'grid min-h-16 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-border bg-transparent px-3 py-3 text-left text-fg last:border-b-0 md:grid-cols-[1fr_1.6fr_0.7fr_0.6fr_0.9fr_0.9fr_auto] md:gap-4',
  typePill: 'w-fit rounded-full bg-primary-container px-3 py-1 text-xs text-primary-soft',
  muted: 'text-fg-muted',
  portfolioHistory:
    'flex min-h-0 max-h-[22rem] flex-col gap-4 border-0 border-t border-border-strong bg-canvas px-5 pt-8 shadow-none sm:px-7 sm:pt-10 lg:h-full lg:max-h-none lg:border-t-0 lg:px-7 lg:pl-8 lg:pt-0',
  historyList: 'flex min-h-0 flex-1 flex-col overflow-hidden',
  historyRows: 'grid min-h-0 flex-1 content-start gap-5 overflow-y-auto lg:gap-7',
  marketIndexPanel: 'grid gap-4 border-0 bg-canvas px-5 py-5 shadow-none sm:px-7 sm:py-7',
  marketIndexGrid: 'grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4',
  marketIndexCard: 'grid min-h-28 content-center gap-2 bg-transparent p-4',
  marketIndexValue: 'break-words text-xl font-black text-fg',
  emptyState: 'flex flex-1 items-center justify-center py-8 text-center',
  miniOrder: 'grid grid-cols-[minmax(0,1fr)_auto] gap-3',
  tradeLayout:
    'trade-layout grid w-full min-w-0 grid-cols-1 items-stretch gap-5 lg:min-h-[calc(100dvh-6rem)] lg:grid-cols-5',
  watchlist:
    'order-3 grid min-w-0 content-start gap-2 overflow-visible border-t border-border bg-canvas pt-4 shadow-none lg:col-span-1 lg:h-full lg:min-h-[calc(100dvh-6rem)] lg:overflow-y-auto lg:border-t-0 lg:border-l lg:pt-0 lg:pl-2',
  watchSearch:
    'm-3 inline-flex min-h-11 items-center gap-2 rounded-full bg-inset px-4 text-left font-medium text-fg-muted outline outline-1 outline-border-subtle transition hover:bg-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-soft',
  watchRow:
    'grid min-h-18 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-lg border-l-2 border-transparent px-4 py-3 text-left text-fg transition hover:bg-active focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary-soft',
  watchRowActive: 'bg-inset',
  centerStack: 'order-1 col-span-3 flex min-h-0 h-full flex-col gap-5',
  stockMetadataPanel: 'grid min-h-0 gap-4 rounded-[24px] border-0 bg-canvas p-0 shadow-none sm:p-6',
  stockBodyGrid: 'grid min-h-0 flex-1 gap-5 lg:grid-rows-3',
  tradeSeparator: 'order-3 hidden',
  stockPanel:
    'grid min-h-0 h-full grid-rows-[auto_auto_1fr] gap-4 rounded-[24px] border-0 bg-canvas p-0 shadow-none sm:p-6',
  stockPanelSpan: 'lg:row-span-2',
  stockTitle: 'flex flex-wrap items-start justify-between gap-3',
  stockHoldingNote:
    'inline-flex w-fit items-center rounded-full border border-border bg-inset px-4 py-2 text-sm font-semibold text-fg-secondary',
  quoteBox: 'grid justify-items-start gap-1 sm:justify-items-end',
  periodTabs: 'flex flex-wrap justify-start gap-2 sm:justify-end',
  periodButton: 'min-h-7 rounded-full bg-transparent px-3 text-xs font-bold text-fg-faint',
  periodButtonActive: 'bg-primary-soft text-on-primary',
  chartActions: 'flex flex-wrap items-center justify-between gap-4',
  smallTabs: 'grid grid-cols-2 gap-1 rounded-full bg-inset p-1',
  smallTab: 'min-h-8 rounded-full bg-transparent px-3 text-xs font-bold text-fg-muted',
  smallTabActive: 'bg-primary-container text-primary-soft',
  chartBox: 'mt-1 h-72 min-h-0 overflow-hidden rounded-[20px] bg-inset lg:h-full lg:min-h-[14rem]',
  chartLine: 'fill-none stroke-positive stroke-[3]',
  boxplot: 'grid min-h-36 content-center gap-5 rounded-[24px] bg-inset p-7',
  boxplotScale: 'flex justify-between text-xs text-fg-faint',
  boxplotTrack:
    'relative h-20 before:absolute before:inset-x-0 before:top-10 before:h-0.5 before:bg-border-strong',
  whisker: 'absolute top-9 h-3 border-x-2 border-fg-secondary',
  box: 'absolute top-6 h-9 rounded-xl border-2 border-primary bg-primary/25',
  median: 'absolute top-4 h-12 border-l-4 border-median',
  infoTabPanel: 'grid gap-0 rounded-[24px] border-0 bg-canvas p-0 shadow-none sm:p-6',
  infoTabList: 'flex gap-6 border-b border-border-subtle',
  infoTabButton:
    'relative min-h-10 px-1 text-sm font-black text-fg-faint transition hover:text-primary-soft focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary-soft',
  infoTabButtonActive: 'text-primary-soft',
  infoTabIndicator: 'absolute inset-x-0 bottom-[-1px] block h-0.5 rounded-full bg-primary-soft',
  infoTabBody: 'overflow-hidden pt-4',
  infoTabBodyInner: 'relative min-h-[9.5rem]',
  detailGrid: 'grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3',
  detailItem: 'grid min-h-16 gap-1 rounded-[14px] bg-inset p-3',
  holdingEmpty:
    'rounded-[16px] border border-border bg-inset px-4 py-3 text-sm font-semibold text-fg-faint',
  ticketPanel:
    'order-2 col-span-1 flex h-full min-h-0 flex-col gap-4 overflow-visible border-0 bg-canvas p-0 shadow-none sm:p-6 lg:overflow-hidden',
  ticketTop: 'shrink-0',
  ticketScroll: 'min-h-0 flex-1 overflow-y-auto pr-1',
  ticketScrollInner: 'grid content-start gap-3',
  ticketBottom: 'grid shrink-0 gap-3',
  ticketBox: 'grid grid-cols-1 gap-3',
  advancedOptions: 'group bg-transparent p-0',
  advancedSummary:
    'flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 rounded-[16px] bg-inset px-4 text-sm font-extrabold text-primary-soft transition hover:bg-hover marker:hidden [&::-webkit-details-marker]:hidden',
  advancedSummaryIconWrap: 'grid h-4 w-4 place-items-center',
  advancedSummaryIcon: 'h-4 w-4',
  advancedBody: 'grid gap-2 pt-3',
  advancedLabel: 'text-xs font-extrabold text-fg-muted',
  accountTypeGrid: 'grid grid-cols-2 gap-2',
  accountTypeButton:
    'relative isolate grid min-h-11 place-items-center overflow-hidden rounded-[14px] bg-inset px-2 py-2 text-center text-xs font-extrabold leading-snug text-fg-muted transition hover:bg-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-soft',
  accountTypeButtonActive: 'text-primary-soft',
  accountTypeIndicator: 'absolute inset-0 -z-10 rounded-[14px] bg-primary-container',
  accountTypeText: 'relative block whitespace-normal break-keep leading-snug',
  label: 'grid gap-2 text-xs font-extrabold text-fg-muted',
  input:
    'min-h-12 w-full rounded-[16px] border border-border-strong bg-inset px-4 text-fg outline-none transition placeholder:text-fg-placeholder focus:border-primary',
  estimateSummary:
    'flex flex-wrap items-center justify-between gap-2 rounded-[18px] border border-border bg-inset px-5 py-4',
  holdingNote:
    'rounded-[16px] border border-border bg-inset px-4 py-3 text-sm font-semibold text-fg-secondary',
  actions: 'grid gap-3',
  primaryButton:
    'inline-flex min-h-10 items-center justify-center gap-2 rounded-full bg-primary px-5 font-extrabold text-on-primary transition hover:bg-primary-soft disabled:opacity-50',
  dangerButton:
    'inline-flex min-h-10 items-center justify-center gap-2 rounded-full bg-danger px-5 font-extrabold text-on-danger transition hover:bg-danger-hover disabled:opacity-50',
  ghostButton:
    'inline-flex min-h-10 items-center justify-center gap-2 rounded-full border border-border-strong bg-transparent px-5 font-extrabold text-primary-soft transition hover:bg-primary-container',
  list: 'grid gap-2',
  orderRow:
    'grid grid-cols-2 items-center gap-3 rounded-2xl border border-border bg-transparent p-4 md:grid-cols-[minmax(180px,1fr)_auto_auto_auto_auto_minmax(12rem,auto)]',
  statusBadge:
    'w-fit rounded-full bg-primary-container px-3 py-1 text-xs font-black text-primary-soft',
  pendingBadge: 'bg-pending text-on-pending',
  apiLayout: 'grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,0.9fr)] lg:gap-7',
  settingsLayout: 'grid gap-7',
  row: 'grid grid-cols-1 items-center gap-3 rounded-2xl border border-border bg-transparent p-4 sm:grid-cols-[minmax(0,1fr)_auto]',
  rowActions: 'flex flex-wrap items-center justify-end gap-2',
  keyRow: 'grid gap-3 rounded-3xl border border-border bg-transparent p-4',
  profileRow:
    'grid grid-cols-[auto_minmax(0,1fr)] items-center gap-3 rounded-2xl border border-border bg-transparent p-4 sm:grid-cols-[auto_minmax(0,1fr)_auto]',
  searchOverlay: 'fixed inset-0 z-20 bg-overlay backdrop-blur-sm',
  searchSheet:
    'mx-auto mt-2 grid max-h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] max-w-[48rem] gap-3 overflow-auto rounded-[28px] border border-border bg-surface/85 p-3 shadow-2xl shadow-black/35 sm:mt-4 sm:max-h-[85vh] sm:w-[calc(100vw-2rem)] sm:p-4 md:w-[48rem]',
  searchInputRow: 'grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_auto]',
  filterRow: 'grid grid-cols-1 gap-3 sm:grid-cols-2',
  searchResults: 'grid gap-2',
  searchLoading: 'flex min-h-32 flex-col items-center justify-center gap-3 py-8 text-fg-muted',
  searchResult:
    'flex min-h-16 flex-wrap items-center justify-between gap-4 rounded-[20px] border border-transparent bg-inset p-4 text-left text-fg transition hover:bg-active focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-soft',
  searchResultActive: 'border-l-4 border-primary-soft bg-active',
  searchResultFocus:
    'bg-active outline outline-2 outline-primary-soft outline-offset-[-2px] shadow-[0_0_0_1px_color-mix(in_srgb,var(--primary-soft)_35%,transparent)]',
  confirmList: 'grid gap-2',
  confirmRow: 'flex justify-between gap-3 border-b border-border-subtle pb-2',
  dialogNote: 'leading-7 text-fg-secondary',
} as const
