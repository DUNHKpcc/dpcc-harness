/**
 * iLink Bot API (WeChat ClawBot) wire types.
 *
 * Ported from the official ClawBot bridge protocol. Only the subset needed for
 * text + voice-to-text messaging is modelled here; media upload/download is out
 * of scope for the bridge's first version.
 */

// ─── Credentials ───────────────────────────────────────────

export interface Credentials {
  botToken: string;
  baseUrl: string;
  ilinkBotId: string;
  ilinkUserId: string;
}

// ─── Message items ─────────────────────────────────────────

/** Encrypted CDN media descriptor (present on image/voice/file/video items). */
export interface CDNMedia {
  encrypt_query_param: string;
  aes_key: string;
  encrypt_type?: number;
  full_url?: string;
}

export interface TextItem {
  text: string;
}

export interface VoiceItem {
  media?: CDNMedia;
  encode_type?: number;
  /** Server-side voice-to-text transcription, when available. */
  text?: string;
  playtime?: number;
}

export interface RefMsg {
  title?: string;
  message_item?: MessageItem;
}

export interface MessageItem {
  /** 1 = text, 2 = image, 3 = voice, 4 = file, 5 = video. */
  type: 1 | 2 | 3 | 4 | 5;
  create_time_ms?: number;
  update_time_ms?: number;
  is_completed?: boolean;
  text_item?: TextItem;
  voice_item?: VoiceItem;
  ref_msg?: RefMsg;
}

// ─── Messages ──────────────────────────────────────────────

export interface WeixinMessage {
  message_id: number;
  from_user_id: string;
  to_user_id: string;
  client_id: string;
  create_time_ms: number;
  /** 1 = USER, 2 = BOT. */
  message_type: number;
  /** 0 = NEW, 1 = GENERATING, 2 = FINISH. */
  message_state: number;
  context_token: string;
  item_list: MessageItem[];
}

// ─── API responses ─────────────────────────────────────────

export interface QRCodeResponse {
  qrcode: string;
  qrcode_img_content: string;
}

export interface QRCodeStatusResponse {
  status: "wait" | "scaned" | "confirmed" | "expired";
  bot_token?: string;
  ilink_bot_id?: string;
  ilink_user_id?: string;
  baseurl?: string;
}

export interface GetUpdatesResponse {
  ret: number;
  msgs: WeixinMessage[];
  get_updates_buf: string;
  longpolling_timeout_ms: number;
  errcode: number;
  errmsg: string;
}

export interface GetConfigResponse {
  typing_ticket: string;
  ret: number;
}
