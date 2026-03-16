# QR Code Placeholder

This folder is for storing QR code images for UPI payments.

## How to Add Your QR Code

### 1. Generate Your QR Code

1. Open your UPI app (PhonePe, Paytm, Google Pay, etc.)
2. Go to "Scan to Pay"
3. Save the QR code as an image to your computer
   - OR use an online UPI QR generator

### 2. Recommended Image Specifications

| Property | Recommended Value |
|----------|------------------|
| **Format** | PNG (or WebP for smaller size) |
| **Size** | 200x200 to 400x400 pixels |
| **File name** | `donate-qr.png` |
| **File size** | Under 50KB (for fast loading) |

### 3. Save the File

Place your QR code image here:
```
assets/images/donate-qr.png
```

### 4. Test

After adding your QR code:
1. Run `npm run build`
2. Check `_site/assets/images/donate-qr.png` exists
3. Verify it displays on the donation page

## Security Note

✅ **Safe to Commit:**
- UPI QR codes only contain your UPI ID (e.g., `name@bank`)
- They don't contain passwords or sensitive data
- Many businesses publicly share their QR codes

## Alternative Approaches

### Option 1: Data URI (Not Recommended)
- Embeds QR as base64 in HTML
- Increases page load time
- Makes HTML harder to maintain

### Option 2: External Hosting
- Upload to cloud storage (AWS S3, Cloudinary)
- Increases complexity
- Not necessary for this use case

### Recommended: File in Repository ✅
- Simple and reliable
- Fast loading with GitHub Pages CDN
- Version controlled with rest of site
