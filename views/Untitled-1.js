        hiddenButtons: ['cmdPreview'], // Hides the built-in preview button
        onPreview: function() {
          return false; // Disables the preview functionality
        }
      });

      // Hide the preview button with the magnifying glass icon
      document.querySelectorAll('.btn[data-handler="bootstrap-markdown-cmdPreview"]').forEach(button => {
        button.style.display = 'none';
      });