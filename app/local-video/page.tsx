"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import {
	AlertCircle,
	ArrowLeft,
	CheckCircle,
	Download,
	FileVideo,
	HelpCircle,
	Loader2,
	RotateCcw,
	Upload,
	Zap,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import { createAndDownloadPPT } from "@/lib/ppt-generation";
import { createAndDownloadPDF, calculatePDFPageCount, type PDFLayout } from "@/lib/pdf-generation";
import { formatTime } from "@/lib/utils";
import { diagnoseVideoFile } from "@/lib/video-diagnostics";
import { convertToMp4, extractFramesFromVideo, preprocessVideo } from "@/lib/video-processing";

type ProcessingState = "idle" | "uploading" | "analyzing" | "extracting" | "completed" | "error" | "converting";

const LocalVideoPage = () => {
	// Processing Configuration
	const [captureInterval, setCaptureInterval] = useState(5); // seconds - SMALLER = MORE SLIDES
	const [customThreshold, setCustomThreshold] = useState(30);
	const [autoThreshold, setAutoThreshold] = useState(true);

	// Export Configuration
	const [exportConfig, setExportConfig] = useState<{
		filename: string;
		format: "pdf" | "pptx";
		layout: PDFLayout;
	}>({
		filename: "slides",
		format: "pdf",
		layout: "1-up",
	});

	// Selection State
	const [selectedFrames, setSelectedFrames] = useState<Set<number>>(new Set());

	// File and video state
	const [selectedFile, setSelectedFile] = useState<File | null>(null);
	const [videoUrl, setVideoUrl] = useState<string>("");
	const [processingState, setProcessingState] = useState<ProcessingState>("idle");
	const [progress, setProgress] = useState<number>(0);
	const [error, setError] = useState<string>("");

	// Video analysis results
	const [screenshots, setScreenshots] = useState<string[]>([]);
	const [videoMetadata, setVideoMetadata] = useState<{
		duration: number;
		width: number;
		height: number;
		size: number;
	} | null>(null);

	// Refs
	const fileInputRef = useRef<HTMLInputElement>(null);
	const videoRef = useRef<HTMLVideoElement>(null);
	const canvasRef = useRef<HTMLCanvasElement>(null);

	// Calculate estimated frame count
	const estimatedFrames = videoMetadata
		? Math.floor(videoMetadata.duration / captureInterval)
		: 0;

	// Check if format is supported for conversion
	const isSupportedFormat = useCallback((file: File): boolean => {
		const supportedTypes = [
			"video/mp4",
			"video/webm",
			"video/quicktime",
			"video/x-msvideo",
			"video/x-matroska",
			"video/3gpp",
			"video/x-flv",
			"video/x-ms-wmv",
			"video/ogg",
			"video/x-ms-asf",
			"video/x-f4v",
			"video/x-m4v",
		];
		const supportedExtensions = [
			".mp4",
			".webm",
			".mov",
			".avi",
			".mkv",
			".3gp",
			".flv",
			".wmv",
			".ogv",
			".asf",
			".f4v",
			".m4v",
		];

		const fileName = file.name.toLowerCase();
		return supportedTypes.includes(file.type) || supportedExtensions.some((ext) => fileName.endsWith(ext));
	}, []);

	// Enhanced format checking
	const isMP4Format = useCallback((file: File): boolean => {
		return file.type === "video/mp4" || file.name.toLowerCase().endsWith(".mp4");
	}, []);

	// Get video metadata with timeout protection
	const getVideoMetadata = useCallback(async (file: File, url: string) => {
		try {
			const video = document.createElement("video");
			video.preload = "metadata";
			video.src = url;

			await new Promise<void>((resolve, reject) => {
				const timeoutId = setTimeout(() => {
					// Fallback if metadata loading takes too long
					console.warn("Metadata loading timed out, proceeding with basic info");
					resolve();
				}, 3000);

				video.onloadedmetadata = () => {
					clearTimeout(timeoutId);
					setVideoMetadata({
						duration: video.duration || 0,
						width: video.videoWidth || 1280,
						height: video.videoHeight || 720,
						size: file.size,
					});
					resolve();
				};

				video.onerror = () => {
					clearTimeout(timeoutId);
					console.warn("Video metadata load error");
					// Don't reject, just proceed - processing might fix it
					resolve();
				};
			});

			// Always clear processing state
			setProcessingState("idle");
		} catch (e) {
			console.error("Error in metadata loading:", e);
			setProcessingState("idle"); // Ensure we don't get stuck
		}
	}, []);

	// Clean up video URL on unmount
	useEffect(() => {
		return () => {
			if (videoUrl) URL.revokeObjectURL(videoUrl);
		};
	}, [videoUrl]);

	// Handle file selection
	const handleFileSelect = useCallback(
		async (file: File) => {
			// Validate file type
			if (!file.type.startsWith("video/") && !isSupportedFormat(file)) {
				setError("请选择有效的视频文件格式");
				return;
			}

			// Validate file size (200MB limit)
			const maxSize = 200 * 1024 * 1024;
			if (file.size > maxSize) {
				setError("文件大小不能超过200MB");
				return;
			}

			// Reset states
			setError("");
			setProgress(0);
			setScreenshots([]);
			setVideoMetadata(null);
			setVideoUrl("");

			setSelectedFile(file);
			setProcessingState("uploading");
			setSelectedFrames(new Set());

			try {
				let finalFile = file;

				// Diagnose file format
				const videoInfo = diagnoseVideoFile(file);
				console.log("Video diagnosis:", videoInfo);

				// Check if file is MP4, if not convert it
				if (!isMP4Format(file)) {
					console.log("Non-MP4 format detected, converting to MP4...");
					setError(`检测到${videoInfo.detectedFormat}格式，正在转换为MP4...`);

					setProcessingState("converting");
					setProgress(0);

					try {
						const convertedBlob = await convertToMp4(
							file,
							(progressValue) => {
								const validProgress = Math.max(0, Math.min(100, Math.round(progressValue || 0)));
								setProgress(validProgress);
							},
							file.name.split(".").pop()?.toLowerCase()
						);

						const convertedFileName = file.name.replace(/\.[^/.]+$/, "_converted.mp4");
						finalFile = new File([convertedBlob], convertedFileName, {
							type: "video/mp4",
						});
						console.log(`Conversion completed: ${finalFile.name}`);
					} catch (conversionError) {
						console.error("Conversion failed", conversionError);
						throw conversionError;
					}

					setSelectedFile(finalFile);
					setError("");
				}

				// Create video URL for preview
				const url = URL.createObjectURL(finalFile);
				setVideoUrl(url);

				// Get video metadata
				getVideoMetadata(finalFile, url);
			} catch (error) {
				console.error("Error processing file:", error);
				setError(error instanceof Error ? error.message : "文件处理失败");
				setProcessingState("error");
				setVideoUrl("");
			}
		},
		[isSupportedFormat, isMP4Format, getVideoMetadata]
	);

	// Handle drag and drop
	const handleDragOver = useCallback((e: React.DragEvent) => {
		e.preventDefault();
		e.stopPropagation();
	}, []);

	const handleDrop = useCallback(
		(e: React.DragEvent) => {
			e.preventDefault();
			e.stopPropagation();
			const files = e.dataTransfer.files;
			if (files.length > 0) {
				handleFileSelect(files[0]);
			}
		},
		[handleFileSelect]
	);

	// File input change handler
	const handleFileInputChange = useCallback(
		(e: React.ChangeEvent<HTMLInputElement>) => {
			const files = e.target.files;
			if (files && files.length > 0) {
				handleFileSelect(files[0]);
			}
		},
		[handleFileSelect]
	);

	// Process video
	const handleProcessVideo = useCallback(async () => {
		if (!selectedFile || !videoRef.current || !canvasRef.current) return;

		try {
			setProcessingState("analyzing");
			setProgress(0);
			setScreenshots([]);
			setSelectedFrames(new Set());

			const video = videoRef.current;
			const canvas = canvasRef.current;

			// Wait for video to be ready
			if (video.readyState < 2) {
				await new Promise<void>((resolve, reject) => {
					video.onloadedmetadata = () => resolve();
					video.onerror = () => reject(new Error("Video load failed"));
					setTimeout(() => {
						if (video.readyState < 2) resolve();
					}, 2000);
				});
			}

			// Determine threshold
			let finalThreshold = customThreshold;

			if (autoThreshold) {
				setProcessingState("analyzing");
				finalThreshold = await preprocessVideo(video, canvas);
				console.log(`Using auto-calculated threshold: ${finalThreshold}`);
			} else {
				console.log(`Using manual threshold: ${finalThreshold}`);
			}

			setProcessingState("extracting");

			// Extract frames using current interval
			// CRITICAL: captureInterval is in SECONDS
			// Smaller interval = MORE frequent sampling = MORE slides
			await extractFramesFromVideo(
				video,
				canvas,
				{
					captureInterval: captureInterval, // This is CORRECT
					differenceThreshold: finalThreshold,
					maxScreenshots: 256,
				},
				{
					onProgress: (progressPercent) => {
						setProgress(progressPercent);
					},
					onFrameCaptured: (blob, url) => {
						setScreenshots((prev) => [...prev, url]);
					},
					onComplete: (blobs) => {
						setProcessingState("completed");
						setProgress(100);
						// Auto-select all frames by default
						const allIndices = new Set(blobs.map((_, i) => i));
						setSelectedFrames(allIndices);
					},
				}
			);
		} catch (error) {
			console.error("Error processing video:", error);
			setError("视频处理失败，请重试");
			setProcessingState("error");
		}
	}, [selectedFile, captureInterval, customThreshold, autoThreshold]);

	// Toggle frame selection
	const toggleFrameSelection = useCallback((index: number) => {
		setSelectedFrames((prev) => {
			const newSet = new Set(prev);
			if (newSet.has(index)) {
				newSet.delete(index);
			} else {
				newSet.add(index);
			}
			return newSet;
		});
	}, []);

	// Select/Deselect all
	const handleSelectAll = useCallback(() => {
		if (selectedFrames.size === screenshots.length) {
			setSelectedFrames(new Set());
		} else {
			setSelectedFrames(new Set(screenshots.map((_, i) => i)));
		}
	}, [selectedFrames.size, screenshots.length]);

	// Download
	const handleDownload = useCallback(async () => {
		try {
			// Filter screenshots based on selection
			const selectedScreenshots = screenshots.filter((_, i) => selectedFrames.has(i));

			if (selectedScreenshots.length === 0) {
				setError("请至少选择一张幻灯片");
				return;
			}

			const filename = exportConfig.filename || "slides";

			if (exportConfig.format === "pdf") {
				await createAndDownloadPDF(selectedScreenshots, {
					title: selectedFile?.name || "Video Analysis",
					filename: `${filename}.pdf`,
					layout: exportConfig.layout,
				});
			} else {
				await createAndDownloadPPT(selectedScreenshots, {
					title: selectedFile?.name || "Video Analysis",
					maxSlides: 256,
				});
			}
		} catch (error) {
			console.error("Error generating export:", error);
			setError("导出失败，请重试");
		}
	}, [screenshots, selectedFrames, exportConfig, selectedFile?.name]);

	// Reset
	const handleReset = useCallback(() => {
		if (videoUrl) {
			URL.revokeObjectURL(videoUrl);
		}
		setSelectedFile(null);
		setVideoUrl("");
		setProcessingState("idle");
		setProgress(0);
		setError("");
		setScreenshots([]);
		setVideoMetadata(null);
		setSelectedFrames(new Set());

		if (fileInputRef.current) {
			fileInputRef.current.value = "";
		}
	}, [videoUrl]);

	return (
		<div className="min-h-screen bg-zinc-950 text-white relative">
			{/* Background */}
			<div className="fixed inset-0 z-0 overflow-hidden">
				<div className="absolute inset-0 bg-gradient-to-br from-blue-900/20 via-purple-900/20 to-teal-900/20" />
				<div className="absolute inset-0 bg-gradient-to-tr from-zinc-900 via-zinc-900/80 to-zinc-900/60" />
				<div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.02)_1px,transparent_1px)] bg-[size:50px_50px] opacity-100" />
			</div>

			{/* Header */}
			<header className="relative z-10 border-b border-zinc-800/50 backdrop-blur-sm">
				<div className="container mx-auto px-6 py-4">
					<nav className="flex items-center justify-between">
						<Link href="/" className="flex items-center space-x-2 hover:opacity-80 transition-opacity">
							<ArrowLeft className="h-5 w-5" />
							<span>返回首页</span>
						</Link>

						<div className="flex items-center space-x-2">
							<FileVideo className="h-6 w-6 text-blue-400" />
							<span className="text-xl font-semibold">视频转幻灯片</span>
						</div>
					</nav>
				</div>
			</header>

			{/* Main Content */}
			<main className="relative z-10 container mx-auto px-6 py-8">
				<div className="grid lg:grid-cols-3 gap-8">
					{/* Left Column: Video + Preview */}
					<div className="lg:col-span-2 space-y-6">
						{/* Upload/Video Panel */}
						<div className="rounded-2xl bg-gradient-to-br from-zinc-900/50 to-zinc-800/30 border border-zinc-700/50 p-6 backdrop-blur-sm">
							{!selectedFile ? (
								<div
									className="border-2 border-dashed border-zinc-600/50 rounded-xl p-12 text-center hover:border-blue-500/50 hover:bg-blue-500/5 transition-all duration-300 cursor-pointer group"
									onDragOver={handleDragOver}
									onDrop={handleDrop}
									onClick={() => fileInputRef.current?.click()}
								>
									<div className="space-y-6 opacity-0 animate-[fadeIn_0.5s_ease-in-out_forwards]">
										<div className="mx-auto w-20 h-20 rounded-full bg-gradient-to-br from-blue-500/20 to-purple-500/20 flex items-center justify-center group-hover:scale-110 transition-all duration-300">
											<Upload className="h-10 w-10 text-blue-400" />
										</div>

										<div>
											<h3 className="text-2xl font-semibold mb-2">上传视频文件</h3>
											<p className="text-zinc-400 mb-4">拖拽视频文件到这里，或点击选择文件</p>
											<p className="text-sm text-zinc-500">支持 MP4, WebM, MOV, AVI, MKV 等格式，最大200MB</p>
										</div>

										<Button className="bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700">
											<Upload className="mr-2 h-5 w-5" />
											选择文件
										</Button>
									</div>
								</div>
							) : (
								<div className="space-y-4">
									{/* Video Player */}
									<div className="aspect-video rounded-lg bg-black overflow-hidden relative">
										<video
											ref={videoRef}
											src={videoUrl || undefined}
											className="w-full h-full object-contain"
											controls
											preload="metadata"
										/>

										{/* Processing Overlay */}
										{(processingState === "analyzing" ||
											processingState === "extracting" ||
											processingState === "converting") && (
												<div className="absolute inset-0 bg-black/80 flex items-center justify-center">
													<div className="text-center space-y-4">
														<Loader2 className="h-12 w-12 animate-spin mx-auto text-blue-400" />
														<div>
															<p className="text-lg font-semibold">
																{processingState === "converting" && "转换视频格式中..."}
																{processingState === "analyzing" && "视频分析中..."}
																{processingState === "extracting" && "提取关键帧中..."}
															</p>
															<p className="text-sm text-zinc-400 mt-2">进度: {progress}%</p>
														</div>
													</div>
												</div>
											)}
									</div>

									{/* File Info */}
									{videoMetadata && (
										<div className="grid grid-cols-2 md:grid-cols-4 gap-3 p-3 bg-zinc-800/30 rounded-lg text-sm">
											<div>
												<p className="text-zinc-400 text-xs">时长</p>
												<p className="font-medium">{formatTime(Math.floor(videoMetadata.duration))}</p>
											</div>
											<div>
												<p className="text-zinc-400 text-xs">分辨率</p>
												<p className="font-medium">
													{videoMetadata.width}×{videoMetadata.height}
												</p>
											</div>
											<div>
												<p className="text-zinc-400 text-xs">大小</p>
												<p className="font-medium">{(videoMetadata.size / 1024 / 1024).toFixed(1)} MB</p>
											</div>
											<div>
												<p className="text-zinc-400 text-xs">格式</p>
												<p className="font-medium truncate">{selectedFile.name.split(".").pop()?.toUpperCase()}</p>
											</div>
										</div>
									)}

									{/* Action Buttons - RIGHT BELOW VIDEO */}
									<div className="flex gap-3">
										{processingState === "idle" && (
											<Button
												onClick={handleProcessVideo}
												className="flex-1 bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700"
												size="lg"
											>
												<Zap className="mr-2 h-5 w-5" />
												开始处理
											</Button>
										)}

										{processingState === "completed" && (
											<>
												<Button
													onClick={handleDownload}
													className="flex-1 bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700"
													size="lg"
												>
													<Download className="mr-2 h-5 w-5" />
													下载 {exportConfig.format === "pdf" ? "PDF" : "PPT"}
												</Button>

												<Button
													onClick={handleProcessVideo}
													variant="outline"
													className="border-zinc-700 text-white hover:bg-zinc-800"
													size="lg"
												>
													<RotateCcw className="mr-2 h-4 w-4" />
													重新处理
												</Button>

												<Button
													onClick={handleReset}
													variant="outline"
													className="border-zinc-700 text-white hover:bg-zinc-800"
													size="lg"
												>
													<Upload className="mr-2 h-4 w-4" />
													新视频
												</Button>
											</>
										)}

										{(processingState === "error" || (processingState !== "idle" && processingState !== "completed")) && selectedFile && (
											<Button
												onClick={handleReset}
												variant="outline"
												className="border-zinc-700 text-white hover:bg-zinc-800"
												size="lg"
											>
												重新选择
											</Button>
										)}
									</div>

									{/* Error Display */}
									{error && (
										<div className="p-4 bg-red-900/20 border border-red-500/30 rounded-lg flex items-center space-x-3">
											<AlertCircle className="h-5 w-5 text-red-400" />
											<p className="text-red-300">{error}</p>
										</div>
									)}
								</div>
							)}
						</div>

						{/* Frame Preview Grid */}
						{screenshots.length > 0 && (
							<div className="rounded-2xl bg-gradient-to-br from-zinc-900/50 to-zinc-800/30 border border-zinc-700/50 p-6 backdrop-blur-sm">
								<div className="flex items-center justify-between mb-4">
									<h3 className="text-xl font-bold">
										提取的幻灯片
										<span className="ml-2 text-blue-400">
											{processingState === "completed" && `${selectedFrames.size} 已选 / `}共 {screenshots.length} 张
										</span>
									</h3>
									{processingState === "completed" && (
										<Button onClick={handleSelectAll} variant="outline" size="sm">
											{selectedFrames.size === screenshots.length ? "取消全选" : "全选"}
										</Button>
									)}
								</div>

								{/* Grid */}
								<div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 max-h-[600px] overflow-y-auto pr-2 scrollbar-thin scrollbar-thumb-zinc-600">
									{screenshots.map((src, idx) => (
										<div
											key={idx}
											onClick={() => processingState === "completed" && toggleFrameSelection(idx)}
											className={`cursor-pointer relative aspect-video rounded-lg overflow-hidden border-2 transition-all ${selectedFrames.has(idx)
												? "border-green-500 ring-2 ring-green-500/30 scale-[0.98]"
												: "border-zinc-700 hover:border-zinc-500 hover:scale-[1.02]"
												}`}
										>
											<Image src={src} alt={`Slide ${idx + 1}`} fill className="object-cover" unoptimized />
											<div className="absolute top-1 left-1 bg-black/70 px-2 py-0.5 rounded text-xs font-mono">
												#{idx + 1}
											</div>
											{selectedFrames.has(idx) && (
												<div className="absolute top-1 right-1 bg-green-500 rounded-full p-1">
													<CheckCircle className="w-4 h-4 text-white" />
												</div>
											)}
										</div>
									))}
								</div>
							</div>
						)}
					</div>

					{/* Right Sidebar: Controls */}
					<div className="space-y-6">
						{/* Configuration Panel */}
						<div className="rounded-2xl bg-gradient-to-br from-zinc-900/50 to-zinc-800/30 border border-zinc-700/50 p-6 backdrop-blur-sm">
							<div className="flex items-center justify-between mb-4">
								<h3 className="text-lg font-semibold">处理配置</h3>
								<Dialog>
									<DialogTrigger asChild>
										<button className="text-zinc-400 hover:text-white transition-colors">
											<HelpCircle className="w-5 h-5" />
										</button>
									</DialogTrigger>
									<DialogContent className="max-w-2xl text-white">
										<DialogHeader>
											<DialogTitle>采样间隔说明</DialogTitle>
											<DialogDescription className="text-zinc-400">
												采样间隔决定了每隔多少秒捕获一次画面
											</DialogDescription>
										</DialogHeader>

										<div className="space-y-4">
											<div className="bg-zinc-800 p-4 rounded-lg">
												<h4 className="font-semibold mb-2 text-green-400">✓ 间隔越小 = 幻灯片越多</h4>
												<div className="space-y-2 text-sm font-mono">
													<div className="flex items-center gap-2">
														<span className="text-zinc-400">2秒:</span>
														<span>x-x-x-x-x-x-x-x-x-x-x-x-x-x-x-x-x-x-x-x</span>
														<span className="text-green-400">(20张)</span>
													</div>
													<div className="flex items-center gap-2">
														<span className="text-zinc-400">5秒:</span>
														<span>x----x----x----x----x----x----x----x</span>
														<span className="text-blue-400">(8张)</span>
													</div>
													<div className="flex items-center gap-2">
														<span className="text-zinc-400">10秒:</span>
														<span>x---------x---------x---------x-----</span>
														<span className="text-orange-400">(4张)</span>
													</div>
												</div>
											</div>

											<div>
												<h4 className="font-semibold mb-2">📚 推荐设置</h4>
												<ul className="space-y-2 text-sm">
													<li>
														<span className="font-medium text-blue-400">普通讲座/教学视频:</span> 5-10秒
														<br />
														<span className="text-zinc-400 text-xs">适合内容变化不频繁的场景</span>
													</li>
													<li>
														<span className="font-medium text-green-400">快节奏演示/编程教学:</span> 2-3秒
														<br />
														<span className="text-zinc-400 text-xs">捕获每个操作步骤</span>
													</li>
													<li>
														<span className="font-medium text-orange-400">缓慢讲解/静态内容:</span> 15-30秒
														<br />
														<span className="text-zinc-400 text-xs">减少重复幻灯片</span>
													</li>
												</ul>
											</div>

											{videoMetadata && (
												<div className="bg-blue-900/20 border border-blue-500/30 p-4 rounded-lg">
													<h4 className="font-semibold mb-2">您的视频</h4>
													<ul className="text-sm space-y-1">
														<li>时长: {formatTime(Math.floor(videoMetadata.duration))}</li>
														<li>
															采样间隔 {captureInterval}秒 预计: ~{estimatedFrames} 张（过滤后约{" "}
															{Math.floor(estimatedFrames * 0.1)}-{Math.floor(estimatedFrames * 0.3)} 张）
														</li>
													</ul>
												</div>
											)}
										</div>
									</DialogContent>
								</Dialog>
							</div>

							<div className="space-y-4">
								{/* Sampling Interval Slider */}
								<div>
									<div className="flex justify-between items-center mb-2">
										<label className="text-sm text-zinc-400">采样间隔 (秒)</label>
										<span className="text-sm font-medium text-blue-400">{captureInterval}秒</span>
									</div>

									<input
										type="range"
										min="1"
										max="60"
										value={captureInterval}
										onChange={(e) => setCaptureInterval(parseInt(e.target.value))}
										disabled={processingState === "analyzing" || processingState === "extracting" || processingState === "converting"}
										className="w-full h-2 bg-zinc-700 rounded-lg appearance-none cursor-pointer accent-blue-500"
									/>

									<div className="flex justify-between text-xs text-zinc-500 mt-1">
										<span>密集采样</span>
										<span>稀疏采样</span>
									</div>

									{videoMetadata && (
										<p className="text-xs text-zinc-400 mt-2">
											预计提取: ~{estimatedFrames} 帧 (过滤后约 {Math.floor(estimatedFrames * 0.1)}-
											{Math.floor(estimatedFrames * 0.3)} 帧)
										</p>
									)}
								</div>

								{/* Threshold Settings */}
								<div className="pt-3 border-t border-zinc-700/50">
									<label className="text-sm text-zinc-400 flex items-center gap-2 mb-2">
										<input
											type="checkbox"
											checked={autoThreshold}
											onChange={(e) => setAutoThreshold(e.target.checked)}
											disabled={processingState === "analyzing" || processingState === "extracting" || processingState === "converting"}
											className="rounded border-zinc-600 bg-zinc-700 text-blue-500"
										/>
										自动计算差异阈值
									</label>

									{!autoThreshold && (
										<div className="mt-3">
											<div className="flex justify-between items-center mb-2">
												<span className="text-sm text-zinc-400">差异阈值</span>
												<span className="text-sm font-medium text-blue-400">{customThreshold}</span>
											</div>
											<input
												type="range"
												min="1"
												max="100"
												value={customThreshold}
												onChange={(e) => setCustomThreshold(parseInt(e.target.value))}
												disabled={processingState === "analyzing" || processingState === "extracting" || processingState === "converting"}
												className="w-full h-2 bg-zinc-700 rounded-lg appearance-none cursor-pointer accent-blue-500"
											/>
										</div>
									)}
								</div>
							</div>
						</div>

						{/* Export Configuration */}
						{processingState === "completed" && (
							<div className="rounded-2xl bg-gradient-to-br from-green-900/50 to-emerald-900/30 border border-green-700/50 p-6 backdrop-blur-sm">
								<h3 className="text-lg font-semibold mb-4 flex items-center">
									<Download className="h-4 w-4 mr-2 text-green-400" />
									导出设置
								</h3>

								<div className="space-y-4">
									<div>
										<label className="text-sm text-zinc-400 block mb-2">文件名</label>
										<div className="flex items-center">
											<input
												type="text"
												value={exportConfig.filename}
												onChange={(e) => setExportConfig((prev) => ({ ...prev, filename: e.target.value }))}
												className="flex-1 bg-zinc-800 border border-zinc-700 rounded-l-lg px-3 py-2 text-sm focus:outline-none focus:border-green-500"
												placeholder="slides"
											/>
											<div className="bg-zinc-700 border border-zinc-700 border-l-0 rounded-r-lg px-3 py-2 text-sm text-zinc-400">
												.{exportConfig.format}
											</div>
										</div>
									</div>

									<div>
										<label className="text-sm text-zinc-400 block mb-2">导出格式</label>
										<div className="flex bg-zinc-800 rounded-lg p-1">
											<button
												onClick={() => setExportConfig((prev) => ({ ...prev, format: "pdf" }))}
												className={`flex-1 py-2 text-sm rounded-md transition-all ${exportConfig.format === "pdf"
													? "bg-green-600 text-white shadow"
													: "text-zinc-400 hover:text-white"
													}`}
											>
												PDF文档
											</button>
											<button
												onClick={() => setExportConfig((prev) => ({ ...prev, format: "pptx" }))}
												className={`flex-1 py-2 text-sm rounded-md transition-all ${exportConfig.format === "pptx"
													? "bg-orange-600 text-white shadow"
													: "text-zinc-400 hover:text-white"
													}`}
											>
												PPT幻灯片
											</button>
										</div>
									</div>

									{exportConfig.format === "pdf" && (
										<div>
											<label className="text-sm text-zinc-400 block mb-2">PDF布局</label>
											<div className="grid grid-cols-2 gap-2">
												<button
													onClick={() => setExportConfig((prev) => ({ ...prev, layout: "1-up" }))}
													className={`border rounded-lg p-3 text-center transition-all ${exportConfig.layout === "1-up"
														? "border-green-500 bg-green-500/10 text-green-400"
														: "border-zinc-700 text-zinc-400 hover:border-zinc-600"
														}`}
												>
													<div className="w-8 h-6 mx-auto border border-current rounded mb-1 bg-current opacity-20" />
													<span className="text-xs">单页单图</span>
												</button>
												<button
													onClick={() => setExportConfig((prev) => ({ ...prev, layout: "4-up" }))}
													className={`border rounded-lg p-3 text-center transition-all ${exportConfig.layout === "4-up"
														? "border-green-500 bg-green-500/10 text-green-400"
														: "border-zinc-700 text-zinc-400 hover:border-zinc-600"
														}`}
												>
													<div className="w-8 h-6 mx-auto grid grid-cols-2 gap-0.5 mb-1">
														<div className="border border-current rounded bg-current opacity-20" />
														<div className="border border-current rounded bg-current opacity-20" />
														<div className="border border-current rounded bg-current opacity-20" />
														<div className="border border-current rounded bg-current opacity-20" />
													</div>
													<span className="text-xs">4图拼接</span>
												</button>
											</div>
										</div>
									)}

									<div className="pt-2 text-xs text-zinc-400 text-center bg-zinc-800/50 rounded p-2">
										{exportConfig.format === "pdf"
											? `将生成 ${calculatePDFPageCount(selectedFrames.size, exportConfig.layout)} 页 PDF`
											: `将生成 ${selectedFrames.size} 页 PPT`}
									</div>
								</div>
							</div>
						)}

						{/* Status Panel */}
						<div className="rounded-2xl bg-gradient-to-br from-zinc-900/50 to-zinc-800/30 border border-zinc-700/50 p-6 backdrop-blur-sm">
							<h3 className="text-lg font-semibold mb-4">处理状态</h3>
							<div className="space-y-3 text-sm">
								<div className="flex items-center justify-between">
									<span className="text-zinc-400">当前状态</span>
									<div className="flex items-center space-x-2">
										{(processingState === "analyzing" || processingState === "extracting" || processingState === "converting") && (
											<Loader2 className="h-4 w-4 animate-spin text-blue-400" />
										)}
										{processingState === "completed" && <CheckCircle className="h-4 w-4 text-green-500" />}
										{processingState === "error" && <AlertCircle className="h-4 w-4 text-red-500" />}
										<span>
											{processingState === "idle" && "等待处理"}
											{processingState === "uploading" && "上传中"}
											{processingState === "converting" && "格式转换"}
											{processingState === "analyzing" && "分析中"}
											{processingState === "extracting" && "提取中"}
											{processingState === "completed" && "已完成"}
											{processingState === "error" && "出错"}
										</span>
									</div>
								</div>
								<div className="flex items-center justify-between">
									<span className="text-zinc-400">提取帧数</span>
									<span className="font-medium text-blue-400">{screenshots.length}</span>
								</div>
								{processingState === "completed" && (
									<div className="flex items-center justify-between">
										<span className="text-zinc-400">已选中</span>
										<span className="font-medium text-green-400">{selectedFrames.size}</span>
									</div>
								)}
							</div>
						</div>
					</div>
				</div>
			</main>

			<input ref={fileInputRef} type="file" accept="video/*" onChange={handleFileInputChange} className="hidden" />
			<canvas ref={canvasRef} className="hidden" />
		</div>
	);
};

export default LocalVideoPage;
