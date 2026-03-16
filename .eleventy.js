const { DateTime } = require("luxon");

module.exports = function(eleventyConfig) {
  // Watch CSS files for changes
  eleventyConfig.addWatchTarget("./css/");
  
  // Copy static assets
  eleventyConfig.addWatchTarget("./assets/");
  eleventyConfig.addWatchTarget("./js/");
  
  // Copy files to output
  eleventyConfig.addPassthroughCopy("assets");
  eleventyConfig.addPassthroughCopy("css");
  eleventyConfig.addPassthroughCopy("js");
  eleventyConfig.addPassthroughCopy("favicon.ico");
  eleventyConfig.addPassthroughCopy("robots.txt");
  eleventyConfig.addPassthroughCopy("ads.txt");
  eleventyConfig.addPassthroughCopy("manifest.json");

  // Copy HTML files to root
  eleventyConfig.addPassthroughCopy({ "./index.html": "index.html" });
  eleventyConfig.addPassthroughCopy({ "./privacy-policy.html": "privacy/index.html" });

  // Date formatting filter
  eleventyConfig.addFilter("postDate", (dateObj) => {
    return DateTime.fromJSDate(dateObj).toLocaleString(DateTime.DATE_MED);
  });

  // Format date for ISO
  eleventyConfig.addFilter("isoDate", (dateObj) => {
    return DateTime.fromJSDate(dateObj).toISODate();
  });

  // JSON stringify filter
  eleventyConfig.addFilter("jsonify", (data) => {
    return JSON.stringify(data);
  });

  // Check if data exists
  eleventyConfig.addFilter("defined", (value) => {
    return value !== undefined && value !== null;
  });

  // Slugify filter for URLs
  eleventyConfig.addFilter("slugify", (text) => {
    return text
      .toString()
      .toLowerCase()
      .trim()
      .replace(/\s+/g, '-')
      .replace(/[^\w\-]+/g, '')
      .replace(/\-\-+/g, '-');
  });

  // Absolute URL filter for canonical URLs
  eleventyConfig.addFilter("absoluteUrl", (relativeUrl, baseUrl) => {
    if (!baseUrl) {
      baseUrl = "https://ecoliving-tips.github.io";
    }
    if (!relativeUrl) return baseUrl;
    if (relativeUrl.startsWith("http")) return relativeUrl;
    if (relativeUrl.startsWith("//")) return "https:" + relativeUrl;
    return baseUrl.replace(/\/$/, "") + "/" + relativeUrl.replace(/^\//, "");
  });

  // Collection for published songs
  eleventyConfig.addCollection("songs", function(collectionApi) {
    return collectionApi.getFilteredByGlob("_data/songs.json");
  });

  // Minify HTML output in production
  if (process.env.NODE_ENV === "production") {
    eleventyConfig.addTransform("htmlmin", function(content, outputPath) {
      if (outputPath && outputPath.endsWith(".html")) {
        const htmlmin = require("html-minifier");
        return htmlmin.minify(content, {
          useShortDoctype: true,
          removeComments: true,
          collapseWhitespace: true
        });
      }
      return content;
    });
  }

  return {
    dir: {
      input: ".",
      output: "_site",
      includes: "_includes",
      data: "_data",
      layouts: "_includes"
    },
    templateFormats: ["md", "njk", "html", "liquid"],
    markdownTemplateEngine: "njk",
    htmlTemplateEngine: "njk",
    dataTemplateEngine: "njk",
    quiet: false,
    verbose: true,
    // Exclude existing static HTML files from processing
    "exclude": ["index.html", "privacy-policy.html"]
  };
};
