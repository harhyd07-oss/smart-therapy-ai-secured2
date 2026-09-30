// reportController.js
//
// GET /api/progress-features/reports/:clientId
// Streams a generated PDF back to the browser as a download.
//
// Like measurementController.js, this is the real logic, imported by the
// thin Next.js route file at
// src/app/api/progress-features/reports/[clientId]/route.js.
//
// Access: same as measurementController.js — verified caller, linked
// therapist (own data only) or the client themselves; otherwise 404.

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireUser } from '@/lib/progressAuth';
import { clientDataScope, notFound } from '@/lib/ownership';
import { generateClientReportPdf } from './reportService.js';

export async function GET(request, { params }) {
  const auth = await requireUser(request);
  if (!auth.ok) return auth.response;

  try {
    const { clientId } = params;
    if (!clientId) {
      return NextResponse.json({ error: 'clientId is required' }, { status: 400 });
    }

    const scope = await clientDataScope(auth, clientId);
    if (!scope) return notFound('Client');

    const pdfBuffer = await generateClientReportPdf(prisma, clientId, scope);

    return new NextResponse(pdfBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="progress-report-${clientId}.pdf"`,
      },
    });
  } catch (error) {
    console.error('reportController GET error:', error);
    const status = error.message === 'Client not found' ? 404 : 500;
    return NextResponse.json({ error: error.message }, { status });
  }
}
