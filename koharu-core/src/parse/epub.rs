use std::io::{Cursor, Read};
use zip::ZipArchive;

use crate::FileEntry;

pub fn extract_epub_images(data: &[u8]) -> anyhow::Result<Vec<FileEntry>> {
    let cursor = Cursor::new(data);
    let mut archive = ZipArchive::new(cursor)?;

    // 1. Verify mimetype
    let mimetype = {
        let mut file = archive.by_name("mimetype")?;
        let mut content = String::new();
        file.read_to_string(&mut content)?;
        content.trim().to_string()
    };

    if mimetype != "application/epub+zip" {
        anyhow::bail!("Invalid EPUB mimetype: {}", mimetype);
    }

    // 2. Parse META-INF/container.xml to find OPF file
    let container_xml = {
        let mut file = archive.by_name("META-INF/container.xml")?;
        let mut content = String::new();
        file.read_to_string(&mut content)?;
        content
    };

    let doc = roxmltree::Document::parse(&container_xml)?;
    let rootfile_node = doc
        .descendants()
        .find(|n| n.has_tag_name("rootfile"))
        .ok_or_else(|| anyhow::anyhow!("Missing rootfile in container.xml"))?;

    let opf_path = rootfile_node
        .attribute("full-path")
        .ok_or_else(|| anyhow::anyhow!("Missing full-path attribute in rootfile"))?;

    // The OPF path might contain a directory. We need this directory to resolve relative paths in the OPF.
    let opf_dir = if let Some(pos) = opf_path.rfind('/') {
        &opf_path[..pos + 1]
    } else {
        ""
    };

    // 3. Parse OPF file
    let opf_xml = {
        let mut file = archive.by_name(opf_path)?;
        let mut content = String::new();
        file.read_to_string(&mut content)?;
        content
    };

    let opf_doc = roxmltree::Document::parse(&opf_xml)?;

    // Find manifest and spine
    let manifest_node = opf_doc
        .descendants()
        .find(|n| n.has_tag_name("manifest"))
        .ok_or_else(|| anyhow::anyhow!("Missing manifest in OPF"))?;

    let spine_node = opf_doc
        .descendants()
        .find(|n| n.has_tag_name("spine"))
        .ok_or_else(|| anyhow::anyhow!("Missing spine in OPF"))?;

    // Create a map from id to href
    let mut id_to_href = std::collections::HashMap::new();
    let mut media_types = std::collections::HashMap::new();
    for item in manifest_node.children().filter(|n| n.has_tag_name("item")) {
        let id = item.attribute("id");
        let href = item.attribute("href");
        let media_type = item.attribute("media-type");
        if let (Some(id), Some(href), Some(media_type)) = (id, href, media_type) {
            let decoded_href = percent_encoding::percent_decode_str(href)
                .decode_utf8_lossy()
                .to_string();
            id_to_href.insert(id.to_string(), decoded_href);
            media_types.insert(id.to_string(), media_type.to_string());
        }
    }

    // Process spine (this gives the correct reading order for HTML pages)
    // However, manga EPUBs sometimes just have images directly in the spine or embedded in HTML.
    // If they are embedded in HTML, we might need to parse the HTML to find the image order,
    // or just rely on the spine order and extract any images we find in the manifest.

    // For many manga EPUBs, each page is an HTML file containing a single image.
    // Let's first collect all images.
    let mut all_images = Vec::new();

    // Some manga EPUBs define spine items that are images, but usually they are XHTML.
    // We'll iterate through the spine items.
    let mut spine_items = Vec::new();
    for itemref in spine_node.children().filter(|n| n.has_tag_name("itemref")) {
        if let Some(idref) = itemref.attribute("idref") {
            spine_items.push(idref.to_string());
        }
    }

    // Keep track of extracted full paths to avoid duplicates if they appear multiple times
    let mut extracted_full_paths = std::collections::HashSet::new();

    // 1. Try to extract images based on spine order.
    // For each spine item, if it's an image, extract it. If it's an XHTML file,
    // we could parse it, but for a simple manga extractor, we can just look for images
    // in the HTML file, or just fallback to extracting all images from the manifest
    // sorted by their order of appearance in the manifest.

    for idref in &spine_items {
        if let Some(href) = id_to_href.get(idref) {
            if let Some(media_type) = media_types.get(idref) {
                if media_type.starts_with("image/") {
                    let full_path = format!("{}{}", opf_dir, href);
                    if extracted_full_paths.insert(full_path.clone()) {
                        if let Ok(file_entry) = extract_file(&mut archive, &full_path) {
                            all_images.push(file_entry);
                        }
                    }
                } else if media_type == "application/xhtml+xml" {
                    // It's an HTML page. To properly extract images in order from HTML,
                    // we can read the HTML and look for <img> tags.
                    let full_path = format!("{}{}", opf_dir, href);
                    let mut file_content = String::new();
                    let read_ok = {
                        let file_result = archive.by_name(&full_path);
                        if let Ok(mut file) = file_result {
                            std::io::Read::read_to_string(&mut file, &mut file_content).is_ok()
                        } else {
                            false
                        }
                    };

                    if read_ok {
                        // Simple parsing for <img> tags
                        if let Ok(html_doc) = roxmltree::Document::parse(&file_content) {
                            for img in html_doc
                                .descendants()
                                .filter(|n| n.has_tag_name("img") || n.has_tag_name("image"))
                            {
                                // Use 'src' for <img>, 'xlink:href' for <svg><image>
                                let img_href = img
                                    .attribute("src")
                                    .or_else(|| img.attribute("href"))
                                    .or_else(|| {
                                        img.attributes()
                                            .find(|a| {
                                                a.name() == "href" || a.name() == "xlink:href"
                                            })
                                            .map(|a| a.value())
                                    });

                                if let Some(img_href) = img_href {
                                    // Resolve relative path
                                    let base_dir = if let Some(pos) = full_path.rfind('/') {
                                        &full_path[..pos + 1]
                                    } else {
                                        ""
                                    };

                                    // Handle simple relative paths (doesn't handle ../ fully correctly yet)
                                    let decoded_img_href =
                                        percent_encoding::percent_decode_str(img_href)
                                            .decode_utf8_lossy()
                                            .to_string();
                                    let resolved_href =
                                        resolve_relative_path(base_dir, &decoded_img_href);

                                    if extracted_full_paths.insert(resolved_href.clone()) {
                                        if let Ok(file_entry) =
                                            extract_file(&mut archive, &resolved_href)
                                        {
                                            all_images.push(file_entry);
                                        }
                                    }
                                }
                            }
                        } else {
                            // Fallback: simple string matching for poorly formed XHTML
                            // Many EPUBs have invalid XML in XHTML files.
                            let re = regex::Regex::new(
                                r#"(?i)<(?:img|image)[^>]+(?:src|href)=["']([^"']+)["']"#,
                            )
                            .unwrap();
                            for cap in re.captures_iter(&file_content) {
                                let img_href = &cap[1];
                                let base_dir = if let Some(pos) = full_path.rfind('/') {
                                    &full_path[..pos + 1]
                                } else {
                                    ""
                                };
                                let decoded_img_href =
                                    percent_encoding::percent_decode_str(img_href)
                                        .decode_utf8_lossy()
                                        .to_string();
                                let resolved_href =
                                    resolve_relative_path(base_dir, &decoded_img_href);
                                if extracted_full_paths.insert(resolved_href.clone()) {
                                    if let Ok(file_entry) =
                                        extract_file(&mut archive, &resolved_href)
                                    {
                                        all_images.push(file_entry);
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    // 2. If no images found through spine (or to catch cover images not in spine),
    // extract all remaining images in the manifest. We'll sort them by ID just in case.
    let mut remaining_images = Vec::new();
    for (id, href) in &id_to_href {
        if let Some(media_type) = media_types.get(id) {
            if media_type.starts_with("image/") {
                let full_path = format!("{}{}", opf_dir, href);
                if !extracted_full_paths.contains(&full_path) {
                    if let Ok(file_entry) = extract_file(&mut archive, &full_path) {
                        remaining_images.push((id.clone(), file_entry));
                        extracted_full_paths.insert(full_path);
                    }
                }
            }
        }
    }

    // Sort remaining images by ID
    remaining_images.sort_by(|a, b| natord::compare(&a.0, &b.0));
    for (_, file_entry) in remaining_images {
        all_images.push(file_entry);
    }

    Ok(all_images)
}

fn extract_file<R: std::io::Read + std::io::Seek>(
    archive: &mut ZipArchive<R>,
    path: &str,
) -> anyhow::Result<FileEntry> {
    let mut file = archive.by_name(path)?;
    let mut data = Vec::new();
    file.read_to_end(&mut data)?;

    // Get just the filename
    let name = path.split('/').last().unwrap_or(path).to_string();

    Ok(FileEntry { name, data })
}

fn resolve_relative_path(base: &str, rel: &str) -> String {
    let mut parts: Vec<&str> = base.split('/').filter(|s| !s.is_empty()).collect();
    for part in rel.split('/') {
        if part == ".." {
            parts.pop();
        } else if part != "." && !part.is_empty() {
            parts.push(part);
        }
    }
    parts.join("/")
}
