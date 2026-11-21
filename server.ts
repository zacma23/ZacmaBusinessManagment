import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { GoogleGenAI, Type } from '@google/genai';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);
const isProduction = process.env.NODE_ENV === 'production';

// Load Firebase web API key from provisioned config for ID token verification (requires no IAM)
let firebaseWebApiKey = '';
try {
  const cfgPath = path.resolve(__dirname, 'firebase-applet-config.json');
  if (fs.existsSync(cfgPath)) {
    const parsed = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));
    firebaseWebApiKey = parsed.apiKey || '';
  }
} catch {
  // Ignore if config not present yet
}

// Gemini AI Server-Side Client (shared singleton)
const getGeminiClient = () => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured on the server.');
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
};

// Simple in-memory sliding-window rate limiter per IP + route bucket
const rateBuckets = new Map<string, { count: number; resetAt: number }>();
function checkRateLimit(key: string, maxRequests: number, windowMs: number): boolean {
  const now = Date.now();
  const entry = rateBuckets.get(key);
  if (!entry || now > entry.resetAt) {
    rateBuckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (entry.count >= maxRequests) {
    return false;
  }
  entry.count += 1;
  return true;
}

// Verify Firebase ID token via Identity Toolkit lookup (works on every Firebase tier without Admin IAM)
async function verifyFirebaseBearer(req: express.Request): Promise<{ uid: string; email: string; emailVerified: boolean } | null> {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  const idToken = authHeader.slice(7).trim();
  if (!idToken || idToken.length > 4096 || !firebaseWebApiKey) {
    return null;
  }
  try {
    const resp = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(firebaseWebApiKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken }),
      }
    );
    if (!resp.ok) return null;
    const data = (await resp.json()) as {
      users?: Array<{ localId?: string; email?: string; emailVerified?: boolean }>;
    };
    const user = data.users?.[0];
    if (!user?.localId) return null;
    return {
      uid: user.localId,
      email: user.email || '',
      emailVerified: Boolean(user.emailVerified),
    };
  } catch {
    return null;
  }
}

const SUPPORTED_FIELD_TYPES = new Set([
  'short_text',
  'long_text',
  'email',
  'phone',
  'number',
  'date',
  'time',
  'dropdown',
  'multi_select',
  'radio',
  'checkboxes',
  'file_upload',
  'image_upload',
  'address',
  'url',
  'yes_no',
  'section_heading',
  'conditional',
]);

function sanitizeSlug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'custom-form';
}

function sanitizeText(input: unknown, maxLen: number): string {
  if (typeof input !== 'string') return '';
  return input.replace(/[<>]/g, '').trim().slice(0, maxLen);
}

async function startServer() {
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '2mb' }));

  // Health check
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', service: 'zacma-saas-portal' });
  });

  // ===========================================================================
  // INTEGRATIONS STATUS (Safe boolean flags only — never exposes secret values)
  // ===========================================================================
  app.get('/api/integrations/status', async (req, res) => {
    const verified = await verifyFirebaseBearer(req);
    if (!verified) {
      res.status(401).json({ error: 'Authentication required.' });
      return;
    }
    res.json({
      gemini_ai: {
        configured: Boolean(process.env.GEMINI_API_KEY),
        model: 'gemini-4-hydrogen',
      },
      resend_email: {
        configured: Boolean(process.env.RESEND_API_KEY && process.env.RESEND_FROM_EMAIL),
      },
      twilio_sms: {
        configured: Boolean(
          process.env.TWILIO_ACCOUNT_SID &&
            process.env.TWILIO_AUTH_TOKEN &&
            process.env.TWILIO_FROM_NUMBER
        ),
      },
      whatsapp_cloud: {
        configured: Boolean(
          process.env.WHATSAPP_ACCESS_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID
        ),
      },
    });
  });

  // ===========================================================================
  // PHASE 3: AI-POWERED DYNAMIC FORM GENERATOR (Gemini Structured JSON)
  // ===========================================================================
  app.post('/api/ai/generate-form', async (req, res) => {
    const ip = req.ip || 'unknown';
    if (!checkRateLimit(`ai-form:${ip}`, 20, 60_000)) {
      res.status(429).json({ error: 'Too many form generation requests. Please wait a minute.' });
      return;
    }

    const verified = await verifyFirebaseBearer(req);
    if (!verified) {
      res.status(401).json({ error: 'Authentication required to generate forms.' });
      return;
    }

    const prompt = sanitizeText(req.body?.prompt, 2000);
    const businessUnitName = sanitizeText(req.body?.businessUnitName, 140);
    const businessUnitCategory = sanitizeText(req.body?.businessUnitCategory, 100);
    const servicesOffered = Array.isArray(req.body?.services)
      ? req.body.services.slice(0, 20).map((s: unknown) => sanitizeText(s, 80)).filter(Boolean)
      : [];

    if (!prompt || prompt.length < 10) {
      res.status(400).json({ error: 'Please provide a clear description (at least 10 characters) of the form you want to generate.' });
      return;
    }

    try {
      const ai = getGeminiClient();
      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: `Create a structured, production-ready form schema for the business unit "${businessUnitName || 'Zacma Business Unit'}" (Category: ${businessUnitCategory || 'General Enterprise'}${servicesOffered.length ? `, Services: ${servicesOffered.join(', ')}` : ''}).

Administrator instructions:
${prompt}

Requirements:
- Organize fields cleanly into logical sections using section_heading items where appropriate.
- Always use the exact allowed field types: short_text, long_text, email, phone, number, date, time, dropdown, multi_select, radio, checkboxes, file_upload, image_upload, address, url, yes_no, section_heading.
- Include realistic dropdown/radio/checkbox options when applicable.
- Set sensible required flags, placeholders, helperText, and validation rules (minLength, maxLength, min, max, pattern).
- If conditional follow-up fields make sense (or were requested), set conditionalOnFieldId (referencing an earlier field's id) and conditionalEqualsValue.
- Make sure field IDs are clean snake_case strings (e.g. full_name, email_address, phone_number, preferred_course).`,
        config: {
          systemInstruction:
            'You are an enterprise form architect for Zacma SaaS Portal. Produce clean, well-structured, mobile-friendly form schemas as valid JSON matching the schema.',
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              title: { type: Type.STRING, description: 'Professional form title' },
              description: { type: Type.STRING, description: 'Clear introductory instructions for visitors' },
              slug: { type: Type.STRING, description: 'URL-friendly lowercase hyphenated slug' },
              confirmationMessage: {
                type: Type.STRING,
                description: 'Polite confirmation message displayed after submission',
              },
              fields: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    id: { type: Type.STRING, description: 'Unique snake_case field identifier' },
                    type: {
                      type: Type.STRING,
                      description:
                        'One of: short_text, long_text, email, phone, number, date, time, dropdown, multi_select, radio, checkboxes, file_upload, image_upload, address, url, yes_no, section_heading',
                    },
                    label: { type: Type.STRING, description: 'Human-readable field label' },
                    placeholder: { type: Type.STRING, description: 'Helpful input placeholder' },
                    helperText: { type: Type.STRING, description: 'Optional guidance text below field' },
                    required: { type: Type.BOOLEAN, description: 'Whether field is mandatory' },
                    section: { type: Type.STRING, description: 'Logical section name' },
                    options: {
                      type: Type.ARRAY,
                      items: { type: Type.STRING },
                      description: 'Choices for dropdown, multi_select, radio, checkboxes',
                    },
                    validation: {
                      type: Type.OBJECT,
                      properties: {
                        minLength: { type: Type.INTEGER },
                        maxLength: { type: Type.INTEGER },
                        min: { type: Type.NUMBER },
                        max: { type: Type.NUMBER },
                        pattern: { type: Type.STRING },
                      },
                    },
                    conditionalOnFieldId: {
                      type: Type.STRING,
                      description: 'Optional earlier field id this field depends on',
                    },
                    conditionalEqualsValue: {
                      type: Type.STRING,
                      description: 'Value of conditionalOnFieldId that reveals this field',
                    },
                  },
                  required: ['id', 'type', 'label', 'required'],
                },
              },
            },
            required: ['title', 'description', 'slug', 'confirmationMessage', 'fields'],
          },
        },
      });

      const rawText = (response.text ?? '').trim();
      if (!rawText) {
        res.status(502).json({ error: 'AI returned an empty schema. Please try again.' });
        return;
      }

      const parsed = JSON.parse(rawText);
      const seenIds = new Set<string>();
      const validatedFields = Array.isArray(parsed.fields)
        ? parsed.fields.slice(0, 60).map((f: Record<string, unknown>, idx: number) => {
            const rawType = typeof f.type === 'string' ? f.type : 'short_text';
            const type = SUPPORTED_FIELD_TYPES.has(rawType) ? rawType : 'short_text';
            let id = String(f.id || `field_${idx + 1}`)
              .toLowerCase()
              .replace(/[^a-z0-9_]+/g, '_')
              .replace(/^_+|_+$/g, '')
              .slice(0, 48);
            if (!id || seenIds.has(id)) {
              id = `field_${idx + 1}_${Date.now().toString(36).slice(-3)}`;
            }
            seenIds.add(id);

            const options = Array.isArray(f.options)
              ? f.options.map((o) => sanitizeText(o, 120)).filter(Boolean).slice(0, 40)
              : [];

            const valObj =
              f.validation && typeof f.validation === 'object'
                ? (f.validation as Record<string, unknown>)
                : {};

            return {
              id,
              type,
              label: sanitizeText(f.label, 140) || `Field ${idx + 1}`,
              placeholder: sanitizeText(f.placeholder, 140),
              helperText: sanitizeText(f.helperText, 240),
              required: type === 'section_heading' ? false : Boolean(f.required),
              section: sanitizeText(f.section, 80) || 'General Information',
              options,
              validation: {
                ...(typeof valObj.minLength === 'number' ? { minLength: valObj.minLength } : {}),
                ...(typeof valObj.maxLength === 'number' ? { maxLength: valObj.maxLength } : {}),
                ...(typeof valObj.min === 'number' ? { min: valObj.min } : {}),
                ...(typeof valObj.max === 'number' ? { max: valObj.max } : {}),
                ...(typeof valObj.pattern === 'string' && valObj.pattern.length <= 120
                  ? { pattern: valObj.pattern }
                  : {}),
              },
              ...(typeof f.conditionalOnFieldId === 'string' && f.conditionalOnFieldId.trim()
                ? {
                    conditionalOnFieldId: sanitizeText(f.conditionalOnFieldId, 48),
                    conditionalEqualsValue: sanitizeText(f.conditionalEqualsValue, 120),
                  }
                : {}),
            };
          })
        : [];

      if (validatedFields.length === 0) {
        res.status(422).json({ error: 'Generated form contained no valid fields. Please refine your prompt.' });
        return;
      }

      res.json({
        title: sanitizeText(parsed.title, 180) || 'Generated Inquiry Form',
        description: sanitizeText(parsed.description, 1500),
        slug: sanitizeSlug(String(parsed.slug || parsed.title || 'generated-form')),
        confirmationMessage:
          sanitizeText(parsed.confirmationMessage, 1000) ||
          'Thank you for your submission. Our team will contact you shortly.',
        fields: validatedFields,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to generate form.';
      console.error('AI Form Generation Error:', msg);
      res.status(500).json({ error: `AI Form Generator error: ${msg}` });
    }
  });

  // ===========================================================================
  // PHASE 10: CONTEXTUAL ZACMA AI ASSISTANT (Permission-Scoped)
  // ===========================================================================
  app.post('/api/ai/assistant', async (req, res) => {
    const ip = req.ip || 'unknown';
    if (!checkRateLimit(`ai-assistant:${ip}`, 30, 60_000)) {
      res.status(429).json({ error: 'Too many assistant requests. Please wait a moment.' });
      return;
    }

    const verified = await verifyFirebaseBearer(req);
    if (!verified) {
      res.status(401).json({ error: 'Authentication required for Zacma AI Assistant.' });
      return;
    }

    const message = sanitizeText(req.body?.message, 2000);
    const userRole = sanitizeText(req.body?.userRole, 40) || 'staff';
    const contextSummary = req.body?.contextSummary && typeof req.body.contextSummary === 'object'
      ? req.body.contextSummary
      : {};
    const history: Array<{ role: 'assistant' | 'user'; content: string }> = Array.isArray(req.body?.history)
      ? req.body.history.slice(-8).map((h: Record<string, unknown>) => ({
          role: h.role === 'assistant' ? 'assistant' : 'user',
          content: sanitizeText(h.content, 1000),
        }))
      : [];

    if (!message) {
      res.status(400).json({ error: 'Message is required.' });
      return;
    }

    try {
      const ai = getGeminiClient();
      const systemInstruction = `You are the Zacma AI Assistant inside the Zacma SaaS Portal.
Current User Role: ${userRole}.
Strict Governance Rules:
1. You ONLY answer based on the authorized organization workspace data provided in the context JSON below. Never fabricate leads, numbers, or business units that are not in the context.
2. Respect RBAC: If the user's role is "accountant" or "instructor" without CRM access, politely explain they do not have CRM permissions.
3. For consequential actions (creating a form, drafting bulk communications, navigating to filtered leads), propose a structured suggestedAction with requiresConfirmation: true so the user explicitly reviews and confirms before execution.
4. Keep answers crisp, executive, well-structured, and actionable with real counts/percentages computed from the provided data.`;

      const promptPayload = `AUTHORIZED WORKSPACE SNAPSHOT (scoped strictly to this user's permissions):
${JSON.stringify(contextSummary).slice(0, 24000)}

RECENT CONVERSATION:
${history.map((h) => `${h.role.toUpperCase()}: ${h.content}`).join('\n')}

USER REQUEST:
${message}`;

      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: promptPayload,
        config: {
          systemInstruction,
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              reply: {
                type: Type.STRING,
                description: 'Clear, helpful response using only authorized workspace data',
              },
              suggestedAction: {
                type: Type.OBJECT,
                description: 'Optional actionable shortcut or confirmation proposal',
                properties: {
                  type: {
                    type: Type.STRING,
                    description: 'One of: none, create_form, filter_leads, draft_communication, open_business_units',
                  },
                  label: { type: Type.STRING, description: 'Short plain button label' },
                  requiresConfirmation: { type: Type.BOOLEAN },
                  businessUnitId: { type: Type.STRING },
                  leadStatus: { type: Type.STRING },
                  unassignedOnly: { type: Type.BOOLEAN },
                  formPrompt: { type: Type.STRING },
                  channel: { type: Type.STRING },
                  draftSubject: { type: Type.STRING },
                  draftBody: { type: Type.STRING },
                },
                required: ['type', 'label', 'requiresConfirmation'],
              },
            },
            required: ['reply'],
          },
        },
      });

      const parsed = JSON.parse((response.text ?? '{}').trim());
      res.json({
        reply: typeof parsed.reply === 'string' ? parsed.reply : 'I reviewed your authorized workspace data.',
        suggestedAction:
          parsed.suggestedAction && parsed.suggestedAction.type && parsed.suggestedAction.type !== 'none'
            ? parsed.suggestedAction
            : null,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Assistant request failed.';
      console.error('Zacma AI Assistant Error:', msg);
      res.status(500).json({ error: `Zacma AI Assistant error: ${msg}` });
    }
  });

  // ===========================================================================
  // PHASE 6: COMMUNICATION DISPATCH WITH API APPROVAL RULE GOVERNANCE
  // ===========================================================================
  app.post('/api/communications/dispatch', async (req, res) => {
    const ip = req.ip || 'unknown';
    if (!checkRateLimit(`comm:${ip}`, 40, 60_000)) {
      res.status(429).json({ error: 'Rate limit exceeded for communications.' });
      return;
    }

    const verified = await verifyFirebaseBearer(req);
    if (!verified) {
      res.status(401).json({ error: 'Authentication required to send communications.' });
      return;
    }

    const channel = req.body?.channel === 'sms' ? 'sms' : 'email';
    const recipient = sanitizeText(req.body?.recipient, 200);
    const subject = sanitizeText(req.body?.subject, 250);
    const body = sanitizeText(req.body?.body, 5000);

    if (!recipient || !body) {
      res.status(400).json({ error: 'Recipient and message body are required.' });
      return;
    }

    // Check real server-side configured providers; never invent credentials
    if (channel === 'email' && process.env.RESEND_API_KEY && process.env.RESEND_FROM_EMAIL) {
      try {
        const emailResp = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: process.env.RESEND_FROM_EMAIL,
            to: [recipient],
            subject: subject || 'Message from Zacma Portal',
            text: body,
          }),
        });
        if (emailResp.ok) {
          res.json({ deliveryStatus: 'sent', provider: 'resend_email' });
          return;
        }
        res.json({
          deliveryStatus: 'failed',
          provider: 'resend_email',
          note: `Provider returned HTTP ${emailResp.status}`,
        });
        return;
      } catch {
        res.json({ deliveryStatus: 'failed', provider: 'resend_email' });
        return;
      }
    }

    if (
      channel === 'sms' &&
      process.env.TWILIO_ACCOUNT_SID &&
      process.env.TWILIO_AUTH_TOKEN &&
      process.env.TWILIO_FROM_NUMBER
    ) {
      try {
        const creds = Buffer.from(
          `${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`
        ).toString('base64');
        const params = new URLSearchParams({
          To: recipient,
          From: process.env.TWILIO_FROM_NUMBER,
          Body: body,
        });
        const smsResp = await fetch(
          `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(process.env.TWILIO_ACCOUNT_SID)}/Messages.json`,
          {
            method: 'POST',
            headers: {
              Authorization: `Basic ${creds}`,
              'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: params.toString(),
          }
        );
        if (smsResp.ok) {
          res.json({ deliveryStatus: 'sent', provider: 'twilio_sms' });
          return;
        }
        res.json({
          deliveryStatus: 'failed',
          provider: 'twilio_sms',
          note: `Provider returned HTTP ${smsResp.status}`,
        });
        return;
      } catch {
        res.json({ deliveryStatus: 'failed', provider: 'twilio_sms' });
        return;
      }
    }

    // API Approval Rule: External paid provider not yet approved/configured with server env credentials
    res.json({
      deliveryStatus: 'queued_pending_provider_approval',
      provider: channel === 'email' ? 'resend_email' : 'twilio_sms',
      note:
        channel === 'email'
          ? 'Logged in CRM Communication History. Configure RESEND_API_KEY & RESEND_FROM_EMAIL after Super Admin approval to dispatch live external emails.'
          : 'Logged in CRM Communication History. Configure TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN & TWILIO_FROM_NUMBER after Super Admin approval to dispatch live SMS.',
    });
  });

  // ===========================================================================
  // PHASE 11: PUBLIC FORM SUBMISSION RATE-LIMIT & SPAM CHECKPOINT
  // ===========================================================================
  app.post('/api/security/verify-submission', (req, res) => {
    const ip = req.ip || 'unknown';
    const publicSlugKey = sanitizeText(req.body?.publicSlugKey, 180);
    const honeypot = typeof req.body?.websiteTrap === 'string' ? req.body.websiteTrap.trim() : '';

    if (honeypot.length > 0) {
      res.status(400).json({ allowed: false, reason: 'Automated spam submission rejected.' });
      return;
    }

    if (!publicSlugKey) {
      res.status(400).json({ allowed: false, reason: 'Invalid form identifier.' });
      return;
    }

    if (!checkRateLimit(`public-submit:${ip}:${publicSlugKey}`, 8, 60_000)) {
      res.status(429).json({
        allowed: false,
        reason: 'Too many submissions from this device. Please wait a minute before trying again.',
      });
      return;
    }

    res.json({ allowed: true });
  });

  // ===========================================================================
  // VITE DEV MIDDLEWARE OR PRODUCTION STATIC ASSETS
  // ===========================================================================
  if (!isProduction) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Zacma SaaS Portal running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start Zacma server:', err);
  process.exit(1);
});
