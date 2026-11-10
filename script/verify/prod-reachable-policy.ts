interface HttpSnapshot {
  status: number;
  body: string;
}

export const isPublicAppShell = ({ status, body }: HttpSnapshot): boolean =>
  status === 200 && /<(?:!doctype|html|body)\b/iu.test(body);

// 入口は Cloudflare Access: 未認証は login への 302、資格不正なら 401/403。
export const isProtectedApiGuarded = (status: number): boolean =>
  status === 302 || status === 401 || status === 403;
