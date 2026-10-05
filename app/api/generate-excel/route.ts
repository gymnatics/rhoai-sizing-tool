import { NextRequest, NextResponse } from 'next/server';

/**
 * Proxies the wizard's combined state + calculated sizing result to the
 * Python FastAPI Excel generation microservice (excel-service/), which
 * renders it into the sizing workbook and streams the .xlsx back.
 */
export async function POST(req: NextRequest) {
  const baseUrl = process.env.EXCEL_SERVICE_URL ?? 'http://localhost:8000';

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  try {
    const upstream = await fetch(`${baseUrl}/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });

    if (!upstream.ok) {
      const text = await upstream.text().catch(() => '');
      return NextResponse.json(
        { error: `Excel service error (HTTP ${upstream.status}): ${text.slice(0, 500)}` },
        { status: 502 },
      );
    }

    const arrayBuffer = await upstream.arrayBuffer();
    return new NextResponse(arrayBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': 'attachment; filename="rhoai-sizing.xlsx"',
      },
    });
  } catch (err) {
    const message = err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')
      ? 'Excel service timed out.'
      : `Could not reach the Excel service at ${baseUrl}. Is it running? (cd excel-service && uvicorn main:app)`;
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
