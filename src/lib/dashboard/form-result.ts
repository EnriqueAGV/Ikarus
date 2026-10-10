export type FormResult = { ok: boolean; message: string; field?: string; code?: string; href?: string };
export type FormAction = (form: FormData) => Promise<FormResult>;
