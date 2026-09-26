/** Android request identity verified against the live VPass app API. */
export const DEFAULT_VPASS_OS_VERSION = '15'

/**
 * Synthetic WebView identity used when a caller does not supply one.
 *
 * The app/version prefix is deliberately excluded so it always follows the
 * externally selected app version.
 */
export const DEFAULT_VPASS_WEBVIEW_USER_AGENT =
  'Mozilla/5.0 (Linux; Android; Pixel; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/150.0.7871.181 Mobile Safari/537.36'

export const buildVpassUserAgent = (appVersion: string): string =>
  `com.smbc_card.vpass.android_v${appVersion} ${DEFAULT_VPASS_WEBVIEW_USER_AGENT}`
