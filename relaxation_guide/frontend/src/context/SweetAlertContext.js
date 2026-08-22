import React, { createContext, useState, useContext } from 'react';
import { SweetAlertModal } from '../components/SweetAlertModal';

const SweetAlertContext = createContext();

export const SweetAlertProvider = ({ children }) => {
  const [alertConfig, setAlertConfig] = useState({
    visible: false,
    title: '',
    text: '',
    icon: 'info',
    confirmButtonText: 'OK',
    showCancelButton: false,
    cancelButtonText: 'Cancel',
    onConfirm: null,
    onCancel: null,
    timer: 0
  });

  const showAlert = ({
    title = '',
    text = '',
    icon = 'info',
    confirmButtonText = 'OK',
    showCancelButton = false,
    cancelButtonText = 'Cancel',
    onConfirm = null,
    onCancel = null,
    timer = 0
  }) => {
    setAlertConfig({
      visible: true,
      title,
      text,
      icon,
      confirmButtonText,
      showCancelButton,
      cancelButtonText,
      onConfirm,
      onCancel,
      timer
    });
  };

  const hideAlert = () => {
    setAlertConfig((prev) => ({ ...prev, visible: false }));
  };

  return (
    <SweetAlertContext.Provider value={{ showAlert, hideAlert }}>
      {children}
      <SweetAlertModal
        visible={alertConfig.visible}
        onClose={hideAlert}
        title={alertConfig.title}
        text={alertConfig.text}
        icon={alertConfig.icon}
        confirmButtonText={alertConfig.confirmButtonText}
        showCancelButton={alertConfig.showCancelButton}
        cancelButtonText={alertConfig.cancelButtonText}
        onConfirm={alertConfig.onConfirm}
        onCancel={alertConfig.onCancel}
        timer={alertConfig.timer}
      />
    </SweetAlertContext.Provider>
  );
};

export const useSweetAlert = () => useContext(SweetAlertContext);
