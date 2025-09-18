export async function GET() {
  // 仅返回是否存在与打码后的前后缀，避免泄漏完整密钥
  const mask = (v) =>
    typeof v === "string" && v.length > 8
      ? `${v.slice(0, 4)}***${v.slice(-4)}`
      : v || null;

  const body = {
    SUPABASE_URL: !!process.env.SUPABASE_URL,
    SUPABASE_KEY_present: !!process.env.SUPABASE_KEY,
    SUPABASE_ANON_KEY_present: !!process.env.SUPABASE_ANON_KEY,
    NEXT_PUBLIC_SUPABASE_URL: !!process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY_present: !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    // 打码回显，便于核对是否加载了正确文件
    _echo: {
      SUPABASE_URL: mask(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL),
      KEY: mask(
        process.env.SUPABASE_KEY ||
          process.env.SUPABASE_ANON_KEY ||
          process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
      ),
    },
    NODE_ENV: process.env.NODE_ENV,
  };

  return new Response(JSON.stringify(body, null, 2), {
    headers: { "content-type": "application/json" },
  });
}


