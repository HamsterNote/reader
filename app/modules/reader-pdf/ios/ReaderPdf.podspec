Pod::Spec.new do |s|
  s.name = 'ReaderPdf'
  s.version = '0.1.0'
  s.summary = 'Reader local PDF page renderer'
  s.description = 'Read-only PDFKit pages with reader canonical text selection.'
  s.license = { :type => 'MIT' }
  s.author = 'HamsterNote'
  s.homepage = 'https://github.com/HamsterNote/reader'
  s.platforms = { :ios => '16.4' }
  s.source = { :git => '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.frameworks = 'PDFKit', 'UIKit'
  s.source_files = '**/*.{h,m,mm,swift}'
  s.swift_version = '5.9'
end
