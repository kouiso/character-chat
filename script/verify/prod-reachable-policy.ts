interface HttpSnapshot {
  status: number;
  body: string;
}

export const isPublicAppShell = ({ status, body }: HttpSnapshot): boolean =>
  status === 200 && /<(?:!doctype|html|body)\b/iu.test(body);

export const isProtectedApiGuarded = (status: number): boolean => status === 401 || status === 403;
