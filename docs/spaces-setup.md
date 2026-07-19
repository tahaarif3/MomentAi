# DigitalOcean Spaces (durable uploads)

Mobile clients need image URLs that survive app restarts and ephemeral app disks.

## Env (production)

```env
STORAGE_PROVIDER=s3
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
AWS_REGION=nyc3
AWS_S3_BUCKET_NAME=momentai-uploads
AWS_S3_ENDPOINT=https://nyc3.digitaloceanspaces.com
AWS_S3_FORCE_PATH_STYLE=false
AWS_S3_SKIP_ACL=false
# Public CDN / Spaces endpoint used in returned URLs:
AWS_S3_CUSTOM_DOMAIN=https://momentai-uploads.nyc3.cdn.digitaloceanspaces.com
```

Use your Spaces region/bucket/CDN hostname.

## CORS (required for share-card canvas)

In the Spaces bucket CORS config, allow GET/HEAD from web and Capacitor origins, and expose enough headers for canvas use:

```xml
<CORSConfiguration>
  <CORSRule>
    <AllowedOrigin>https://momentai.dev</AllowedOrigin>
    <AllowedOrigin>https://www.momentai.dev</AllowedOrigin>
    <AllowedOrigin>capacitor://localhost</AllowedOrigin>
    <AllowedOrigin>http://localhost</AllowedOrigin>
    <AllowedOrigin>http://localhost:5173</AllowedOrigin>
    <AllowedMethod>GET</AllowedMethod>
    <AllowedMethod>HEAD</AllowedMethod>
    <AllowedHeader>*</AllowedHeader>
  </CORSRule>
</CORSConfiguration>
```

Without this, `canvas` export of remote moment photos is tainted and native/web share cards fail.

## ACL / public read

Prefer a CDN custom domain with public read on `uploads/*`, or set object ACL `public-read` (`AWS_S3_SKIP_ACL=false`). If the bucket blocks ACLs, use a Spaces CDN policy instead and set `AWS_S3_SKIP_ACL=true`.
