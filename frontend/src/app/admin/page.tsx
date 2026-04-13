"use client";

import { useState } from "react";

import { AdminFoundationTable } from "@/components/admin/AdminFoundationTable";
import { AdminLoginForm } from "@/components/admin/AdminLoginForm";
import { AdminManualFoundationForm } from "@/components/admin/AdminManualFoundationForm";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { AdminPhotoAnalysisForm } from "@/components/admin/AdminPhotoAnalysisForm";
import { AdminRoiValidationPanel } from "@/components/admin/AdminRoiValidationPanel";
import type { ActiveAdminPanel } from "@/components/admin/types";
import { useApiPrewarm } from "@/hooks/useApiPrewarm";
import { useAdminAuthAndFoundations } from "@/hooks/admin/useAdminAuthAndFoundations";
import { usePhotoFoundationWorkflow } from "@/hooks/admin/usePhotoFoundationWorkflow";
import { useRoiValidationWorkflow } from "@/hooks/admin/useRoiValidationWorkflow";

export default function AdminPage() {
  const [activePanel, setActivePanel] = useState<ActiveAdminPanel>("none");

  useApiPrewarm("/ping");

  const foundationWorkflow = useAdminAuthAndFoundations({
    activePanel,
    setActivePanel,
  });
  const photoWorkflow = usePhotoFoundationWorkflow({
    token: foundationWorkflow.auth.token,
    activePanel,
    setActivePanel,
    onFoundationCreated: foundationWorkflow.foundations.integrateCreatedFoundation,
  });
  const roiWorkflow = useRoiValidationWorkflow({
    activePanel,
    setActivePanel,
  });

  if (!foundationWorkflow.auth.token) {
    return (
      <AdminLoginForm
        username={foundationWorkflow.auth.username}
        password={foundationWorkflow.auth.password}
        loginError={foundationWorkflow.auth.loginError}
        isLoggingIn={foundationWorkflow.auth.isLoggingIn}
        onUsernameChange={foundationWorkflow.auth.updateUsername}
        onPasswordChange={foundationWorkflow.auth.updatePassword}
        onSubmit={foundationWorkflow.auth.handleLogin}
      />
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-3 py-4 sm:px-4 sm:py-5">
      <AdminPageHeader
        activePanel={activePanel}
        filterBrand={foundationWorkflow.foundations.filterBrand}
        brands={foundationWorkflow.foundations.brands}
        isLoadingData={foundationWorkflow.foundations.isLoadingData}
        onFilterChange={foundationWorkflow.foundations.updateFilterBrand}
        onRefresh={() => void foundationWorkflow.foundations.refreshFoundations()}
        onToggleRoiTool={() => {
          setActivePanel((current) => (current === "roi" ? "none" : "roi"));
        }}
        onTogglePhotoForm={() => {
          setActivePanel((current) => (current === "photo" ? "none" : "photo"));
        }}
        onToggleManualCreateForm={foundationWorkflow.manual.toggleCreatePanel}
      />

      {foundationWorkflow.foundations.listError && (
        <div className="mb-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {foundationWorkflow.foundations.listError}
        </div>
      )}

      <AdminRoiValidationPanel
        show={activePanel === "roi"}
        roiPreview={roiWorkflow.roiPreview}
        roiFileName={roiWorkflow.roiFileName}
        roiOverlay={roiWorkflow.roiOverlay}
        roiResult={roiWorkflow.roiResult}
        roiError={roiWorkflow.roiError}
        roiImageStatus={roiWorkflow.roiImageStatus}
        roiExtractionReady={roiWorkflow.roiExtractionReady}
        roiAnalyzing={roiWorkflow.roiAnalyzing}
        roiImgRef={roiWorkflow.roiImgRef}
        roiPreviewCanvasRef={roiWorkflow.roiPreviewCanvasRef}
        roiProcessingCanvasRef={roiWorkflow.roiProcessingCanvasRef}
        onClose={roiWorkflow.closeRoiPanel}
        onReset={roiWorkflow.resetRoiState}
        onUpload={roiWorkflow.handleRoiUpload}
        onImageLoad={roiWorkflow.handleRoiImageLoad}
        onAnalyze={() => void roiWorkflow.analyzeRoi()}
      />

      {activePanel === "photo" && (
        <AdminPhotoAnalysisForm
          photoPreview={photoWorkflow.photoPreview}
          photoMeta={photoWorkflow.photoMeta}
          checkerPatches={photoWorkflow.checkerPatches}
          selectingPatch={photoWorkflow.selectingPatch}
          analysisResult={photoWorkflow.analysisResult}
          analyzing={photoWorkflow.analyzing}
          isSavingPhoto={photoWorkflow.isSavingPhoto}
          photoError={photoWorkflow.photoError}
          photoImgRef={photoWorkflow.photoImgRef}
          photoCanvasRef={photoWorkflow.photoCanvasRef}
          onPhotoMetaFieldChange={photoWorkflow.updatePhotoMetaField}
          onPhotoUpload={photoWorkflow.handlePhotoUpload}
          onPhotoImageLoad={photoWorkflow.handlePhotoImageLoad}
          onPhotoCanvasClick={photoWorkflow.handlePhotoCanvasClick}
          onSelectPatch={photoWorkflow.togglePatchSelection}
          onAnalyze={() => void photoWorkflow.analyzeSwatch()}
          onSave={() => void photoWorkflow.saveFromPhoto()}
          onReset={photoWorkflow.resetPhotoState}
          onClose={photoWorkflow.closePhotoPanel}
        />
      )}

      {foundationWorkflow.manual.isOpen && (
        <AdminManualFoundationForm
          editingFoundationId={foundationWorkflow.manual.editingFoundationId}
          form={foundationWorkflow.manual.form}
          isSavingManual={foundationWorkflow.manual.isSavingManual}
          onClose={foundationWorkflow.manual.closeManualPanel}
          onSubmit={foundationWorkflow.manual.handleManualSubmit}
          onFieldChange={foundationWorkflow.manual.updateManualField}
        />
      )}

      <AdminFoundationTable
        filterBrand={foundationWorkflow.foundations.filterBrand}
        foundations={foundationWorkflow.foundations.foundations}
        isLoadingData={foundationWorkflow.foundations.isLoadingData}
        deletingId={foundationWorkflow.foundations.deletingId}
        onEdit={foundationWorkflow.manual.openEditPanel}
        onDelete={foundationWorkflow.foundations.handleDelete}
      />
    </div>
  );
}
