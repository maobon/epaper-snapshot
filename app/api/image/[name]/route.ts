import { EPAPER_IMAGE_SPECS, generateEpaperImage, imageCacheHeaders, type EpaperImageName } from '@/lib/epaper-image';

export const revalidate = 3600;

const allowed = new Set<EpaperImageName>(['currency', 'landscape', 'portrait', 'forecast-15d']);

export async function GET(_request: Request, context: { params: Promise<{ name: string }> }) {
  const { name: rawName } = await context.params;
  const name = rawName.replace(/\.png$/i, '') as EpaperImageName;
  if (!allowed.has(name)) {
    return Response.json({ error: 'Unknown image. Use currency.png, landscape.png, portrait.png, or forecast-15d.png.' }, { status: 404 });
  }

  try {
    const image = await generateEpaperImage(name);
    const responseBody = Uint8Array.from(image.png).buffer;
    return new Response(responseBody, {
      headers: {
        ...imageCacheHeaders(`${name}.png`),
        'Content-Type': 'image/png',
        'Content-Length': String(image.png.byteLength),
        'X-Image-Width': String(EPAPER_IMAGE_SPECS[name].width),
        'X-Image-Height': String(EPAPER_IMAGE_SPECS[name].height),
        'X-Epaper-Gray-Levels': '0,85,170,255',
        'X-Image-Renderer': 'svg-resvg',
      },
    });
  } catch (error) {
    console.error(`Unable to generate ${name} e-paper image:`, error);
    return Response.json({ error: 'Image generation failed.' }, { status: 500 });
  }
}
