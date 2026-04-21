import { describe, expect, it } from "vitest";
import { SettingsManager } from "../src/core/settings-manager.js";

describe("images.maxWidthCells setting", () => {
	it("should default to 60", () => {
		const manager = SettingsManager.inMemory({});
		expect(manager.getImageMaxWidthCells()).toBe(60);
	});

	it("should return configured value", () => {
		const manager = SettingsManager.inMemory({ images: { maxWidthCells: 120 } });
		expect(manager.getImageMaxWidthCells()).toBe(120);
	});

	it("should persist via setImageMaxWidthCells", () => {
		const manager = SettingsManager.inMemory({});
		expect(manager.getImageMaxWidthCells()).toBe(60);

		manager.setImageMaxWidthCells(100);
		expect(manager.getImageMaxWidthCells()).toBe(100);

		manager.setImageMaxWidthCells(30);
		expect(manager.getImageMaxWidthCells()).toBe(30);
	});

	it("should coexist with other image settings", () => {
		const manager = SettingsManager.inMemory({
			images: { autoResize: true, blockImages: false, maxWidthCells: 80 },
		});
		expect(manager.getImageAutoResize()).toBe(true);
		expect(manager.getBlockImages()).toBe(false);
		expect(manager.getImageMaxWidthCells()).toBe(80);
	});

	it("should not affect other image settings when changed", () => {
		const manager = SettingsManager.inMemory({
			images: { autoResize: false, blockImages: true },
		});

		manager.setImageMaxWidthCells(150);
		expect(manager.getImageAutoResize()).toBe(false);
		expect(manager.getBlockImages()).toBe(true);
		expect(manager.getImageMaxWidthCells()).toBe(150);
	});
});
